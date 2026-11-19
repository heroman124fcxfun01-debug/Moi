import test from 'node:test';
import assert from 'node:assert/strict';
import type { Book } from '../types/book';
import {
  applyTranslatedBookOverwrite,
  hasOriginalBookBackup,
  restoreOriginalBookFromBackup,
  splitParagraphsIntoFastBatches,
} from './bookTranslator';
import { LANGUAGE_PACK_CATALOG, detectRoughSourceLang } from './languagePacks';

function makeSampleBook(): Book {
  return {
    id: 'book-en-1',
    title: 'The Starlight Clockmaker',
    author: 'E. Vance',
    description: 'A short English novel.',
    language: 'en',
    sourceType: 'epub',
    addedAt: 1000,
    lastReadAt: 1000,
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    currentSentenceIndex: 0,
    progressPercent: 0,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    chapters: [
      {
        id: 'ch-1',
        index: 0,
        title: 'Chapter 1: Midnight Gears',
        paragraphs: [
          'The clock tower chimed twelve across the harbor.',
          '"Are you awake?" asked Elena softly.',
        ],
      },
      {
        id: 'ch-2',
        index: 1,
        title: 'Chapter 2: Silver Key',
        paragraphs: ['Dawn broke over the brass rooftops.'],
      },
    ],
  };
}

test('splitParagraphsIntoFastBatches groups paragraphs within char & count budgets', () => {
  const paras = Array.from({ length: 10 }, (_, i) => `Paragraph ${i} ` + 'a'.repeat(120));
  const batches = splitParagraphsIntoFastBatches(paras, 500, 4);
  assert.ok(batches.length >= 3);
  const flattened = batches.flatMap((b) => b.paragraphs);
  assert.deepEqual(flattened, paras);
  assert.equal(batches[0].startIndex, 0);
  assert.equal(batches[1].startIndex, batches[0].paragraphs.length);
});

test('applyTranslatedBookOverwrite replaces paragraphs, backs up original, and supports restore', () => {
  const original = makeSampleBook();
  const overwritten = applyTranslatedBookOverwrite(
    original,
    {
      'ch-1': {
        title: 'Chương 1: Bánh răng nửa đêm',
        paragraphs: [
          'Tháp đồng hồ điểm mười hai tiếng vang khắp bến cảng.',
          '"Cậu còn thức không?" Elena khẽ hỏi.',
        ],
      },
      'ch-2': {
        title: 'Chương 2: Chìa khóa bạc',
        paragraphs: ['Bình minh ló rạng trên những mái nhà bằng đồng.'],
      },
    },
    'vi'
  );

  assert.equal(overwritten.language, 'vi');
  assert.equal(overwritten.chapters[0].title, 'Chương 1: Bánh răng nửa đêm');
  assert.equal(
    overwritten.chapters[0].paragraphs[0],
    'Tháp đồng hồ điểm mười hai tiếng vang khắp bến cảng.'
  );
  assert.equal(hasOriginalBookBackup(overwritten), true);

  const restored = restoreOriginalBookFromBackup(overwritten);
  assert.ok(restored);
  assert.equal(
    restored!.chapters[0].paragraphs[0],
    'The clock tower chimed twelve across the harbor.'
  );
});

test('LANGUAGE_PACK_CATALOG covers core languages and source detector identifies scripts', () => {
  const codes = LANGUAGE_PACK_CATALOG.map((p) => p.code);
  assert.ok(codes.includes('vi'));
  assert.ok(codes.includes('en'));
  assert.ok(codes.includes('zh'));
  assert.ok(codes.includes('ja'));
  assert.equal(detectRoughSourceLang('Xin chào thế giới đọc sách'), 'vi');
  assert.equal(detectRoughSourceLang('你好世界'), 'zh');
  assert.equal(detectRoughSourceLang('こんにちは世界'), 'ja');
  assert.equal(detectRoughSourceLang('The quick brown fox'), 'en');
});
