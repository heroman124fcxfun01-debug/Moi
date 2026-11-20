import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanBookChaptersOnDevice,
  cleanParagraphText,
  isJunkScrapedText,
} from './bookCleaner';
import type { Book } from '../types/book';

test('isJunkScrapedText detects HTML header leakage and web scraper watermarks', () => {
  assert.equal(
    isJunkScrapedText('scale=1.0, maximum-scale=1.0, user-scalable=no href="https://fonts.googleapis.com/css2"'),
    true
  );
  assert.equal(isJunkScrapedText('DTV-EBOOK - Đọc truyện miễn phí'), true);
  assert.equal(isJunkScrapedText('TẢI TỪ WEB: https://truyenfull.vn/chuong-1'), true);
  assert.equal(
    isJunkScrapedText('Ánh nắng ban mai xuyên qua khe cửa sổ, chiếu rọi lên trang sách cũ kỹ trên bàn.'),
    false
  );
});

test('cleanParagraphText removes inline HTML tags and watermarks while preserving prose', () => {
  const dirty = '<p>Chàng bước vào&nbsp;điện chính [DTV-EBOOK] với ánh mắt kiên định.</p>';
  assert.equal(
    cleanParagraphText(dirty),
    'Chàng bước vào điện chính với ánh mắt kiên định.'
  );
});

test('cleanBookChaptersOnDevice strips junk paragraphs and preserves valid chapters', () => {
  const dirtyBook: Book = {
    id: 'b-dirty',
    title: 'Kiếm Lai',
    author: 'Phong Hỏa Hí Chư Hầu',
    description: '',
    language: 'vi',
    sourceType: 'epub',
    chapters: [
      {
        id: 'ch-1',
        index: 0,
        title: 'Chương 1',
        paragraphs: [
          'scale=1.0, maximum-scale=1.0, minimum-scale=1.0',
          'href="https://fonts.googleapis.com/css2?family=Lora"',
          'DTV-EBOOK',
          'Thôn nhỏ bên bờ suối quanh năm sương mù bao phủ.',
          'Thiếu niên gánh củi lặng lẽ bước qua cây cầu gỗ cũ kỹ.',
          'Chương tiếp',
        ],
      },
    ],
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent: 0,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt: 1000,
    lastReadAt: 1000,
  };

  const report = cleanBookChaptersOnDevice(dirtyBook);
  assert.equal(report.removedCount, 4);
  assert.equal(report.totalParagraphsAfter, 2);
  assert.deepEqual(report.cleanedBook.chapters[0].paragraphs, [
    'Thôn nhỏ bên bờ suối quanh năm sương mù bao phủ.',
    'Thiếu niên gánh củi lặng lẽ bước qua cây cầu gỗ cũ kỹ.',
  ]);
});
