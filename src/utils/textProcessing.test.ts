import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanExtractedParagraphs,
  splitPagesIntoChapters,
  buildRenderedParagraphs,
  paginateParagraphs,
  computeReadingProgress,
  estimateBookStats,
} from './textProcessing';
import type { Chapter } from '../types/book';

test('cleanExtractedParagraphs splits and normalizes whitespace cleanly', () => {
  const raw = '  Đoạn   thứ nhất.\n\nĐoạn thứ hai\nviết tiếp dòng.  \n\n\nĐoạn thứ ba.';
  const result = cleanExtractedParagraphs(raw);
  assert.deepEqual(result, [
    'Đoạn thứ nhất.',
    'Đoạn thứ hai viết tiếp dòng.',
    'Đoạn thứ ba.',
  ]);
});

test('splitPagesIntoChapters detects Vietnamese chapter headings automatically', () => {
  const pages = [
    'Chương 1: Khởi đầu\n\nTrời vừa hửng sáng trên bến sông.',
    'Lữ khách bước lên con thuyền nhỏ.\n\nChương 2: Cuộc gặp gỡ\n\nÔng lão mỉm cười.',
  ];
  const chapters = splitPagesIntoChapters(pages);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chương 1: Khởi đầu');
  assert.equal(chapters[0].paragraphs.length, 2);
  assert.equal(chapters[1].title, 'Chương 2: Cuộc gặp gỡ');
  assert.equal(chapters[1].paragraphs[0], 'Ông lão mỉm cười.');
});

test('buildRenderedParagraphs handles original, override, and bilingual modes accurately', () => {
  const chapter: Chapter = {
    id: 'c1',
    index: 0,
    title: 'Chapter 1',
    paragraphs: ['Hello world.', 'Time passes quickly.'],
    translations: {
      vi: {
        targetLang: 'vi',
        paragraphs: ['Xin chào thế giới.', 'Thời gian trôi thật nhanh.'],
        translatedAt: 1000,
      },
    },
  };

  const orig = buildRenderedParagraphs(chapter, 'original', 'vi');
  assert.equal(orig[0].original, 'Hello world.');
  assert.equal(orig[0].translated, null);

  const override = buildRenderedParagraphs(chapter, 'override', 'vi');
  assert.equal(override[0].original, 'Xin chào thế giới.');
  assert.equal(override[1].original, 'Thời gian trôi thật nhanh.');
  assert.equal(override[0].translated, null);

  const bilingual = buildRenderedParagraphs(chapter, 'bilingual', 'vi');
  assert.equal(bilingual[0].original, 'Hello world.');
  assert.equal(bilingual[0].translated, 'Xin chào thế giới.');
});

test('paginateParagraphs splits paragraphs respecting max word budget', () => {
  const pairs = [
    { index: 0, original: 'một hai ba bốn năm', translated: null },
    { index: 1, original: 'sáu bảy tám chín mười', translated: null },
    { index: 2, original: 'mười một mười hai', translated: null },
  ];
  const pages = paginateParagraphs(pairs, 10);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 2);
  assert.equal(pages[1].length, 1);
});

test('computeReadingProgress and estimateBookStats calculate accurately', () => {
  const chapters: Chapter[] = [
    { id: '1', index: 0, title: 'C1', paragraphs: ['a b c', 'd e f'] },
    { id: '2', index: 1, title: 'C2', paragraphs: ['g h', 'i j'] },
  ];
  assert.equal(computeReadingProgress(chapters, 0, 0), 25);
  assert.equal(computeReadingProgress(chapters, 1, 1), 100);
  const stats = estimateBookStats(chapters);
  assert.equal(stats.totalWords, 10);
  assert.equal(stats.chapterCount, 2);
});
