import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEpubArchiveSpec, buildEpubBlob, parseEpubBuffer } from './epubBuilder';
import type { Book } from '../types/book';

const sampleBook: Book = {
  id: 'test-book-1',
  title: 'Hành Trình & Ánh Sáng',
  author: 'Nguyễn Minh',
  description: 'Truyện thử nghiệm xuất EPUB.',
  language: 'vi',
  sourceType: 'web',
  chapters: [
    {
      id: 'ch-1',
      index: 0,
      title: 'Chương 1: Khởi hành',
      paragraphs: ['Gió thổi qua thung lũng.', 'Anh bước đi về phía bình minh.'],
      translations: {
        en: {
          targetLang: 'en',
          paragraphs: ['Wind blew across the valley.', 'He walked toward the dawn.'],
          translatedAt: 1000,
        },
      },
    },
    {
      id: 'ch-2',
      index: 1,
      title: 'Chương 2: Ngọn hải đăng',
      paragraphs: ['Ánh đèn xoay đều trong màn sương.'],
    },
  ],
  currentChapterIndex: 0,
  currentParagraphIndex: 0,
  progressPercent: 1,
  bookmarks: [],
  highlights: [],
  voiceAssignments: {},
  addedAt: 1000,
  lastReadAt: 1000,
};

test('buildEpubArchiveSpec creates XML-escaped OPF, NCX, nav, and chapter XHTMLs', () => {
  const spec = buildEpubArchiveSpec(sampleBook);
  assert.equal(spec.mimetype, 'application/epub+zip');
  assert.ok(spec.contentOpf.includes('Hành Trình &amp; Ánh Sáng'));
  assert.equal(spec.chapters.length, 2);
  assert.ok(spec.chapters[0].xhtml.includes('Gió thổi qua thung lũng.'));
});

test('buildEpubArchiveSpec supports bilingual export mode', () => {
  const spec = buildEpubArchiveSpec(sampleBook, {
    translationMode: 'bilingual',
    targetLang: 'en',
  });
  assert.ok(spec.chapters[0].xhtml.includes('Gió thổi qua thung lũng.'));
  assert.ok(spec.chapters[0].xhtml.includes('Wind blew across the valley.'));
});

test('buildEpubBlob and parseEpubBuffer round-trip a valid EPUB archive', async () => {
  const blob = await buildEpubBlob(sampleBook);
  const arrayBuf = await blob.arrayBuffer();
  const parsed = await parseEpubBuffer(arrayBuf, 'hanh-trinh.epub');

  assert.equal(parsed.title, 'Hành Trình & Ánh Sáng');
  assert.equal(parsed.author, 'Nguyễn Minh');
  assert.equal(parsed.chapters.length, 2);
  assert.equal(parsed.chapters[0].title, 'Chương 1: Khởi hành');
  assert.equal(parsed.chapters[0].paragraphs[0], 'Gió thổi qua thung lũng.');
  assert.equal(parsed.chapters[1].paragraphs[0], 'Ánh đèn xoay đều trong màn sương.');
});
