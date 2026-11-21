import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBookCleanupByItemIds,
  applyBookCleanupSelection,
  collectRepeatedLineSignatures,
  evaluateParagraphForPreRead,
  mergeAiBookFindings,
  resolveBatchSpeechWithPreRead,
  scanBookForCleanup,
} from './aiContentCleaner';
import type { Book } from '../types/book';

function makeSampleDirtyBook(): Book {
  return {
    id: 'test-dirty-book',
    title: 'Đỉnh Núi Sương Mù',
    author: 'Tác giả thử nghiệm',
    description: '',
    language: 'vi',
    sourceType: 'epub',
    chapters: [
      {
        id: 'ch-1',
        index: 0,
        title: 'Chương 1',
        paragraphs: [
          'Nguồn: vtbook.vn — https://vtbook.vn/truyen/dinh-nui',
          'Hôm nay ci ấy cùng cả đoàn leo l*n đ*nh núi trong sương sớm.',
          '---------------',
          'Mọi ng ta đều ko nghĩ rằng sẽ đi đc xa đến vậy (tải tại https://truyenfull.vn).',
          '[Chú thích: Bản dịch thực hiện bởi nhóm yêu sách]',
          'Trang 12 / 340',
        ],
      },
      {
        id: 'ch-2',
        index: 1,
        title: 'Chương 2',
        paragraphs: [
          'Đỉnh Núi Sương Mù',
          'Gọi ci ra đây xem cảnh bình minh tuyệt đẹp trên đ*nh núi.',
          '[Chú thích: Bản dịch thực hiện bởi nhóm yêu sách]',
          'Chúc các bạn đọc truyện vui vẻ tại vtbook.vn!',
        ],
      },
    ],
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent: 0,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt: 1,
    lastReadAt: 1,
  };
}

test('aiContentCleaner classifies vtbook/http/dividers, censored/typos (l*n đ*nh, ci), and repeated notes while keeping 1st original copy', () => {
  const book = makeSampleDirtyBook();
  const report = scanBookForCleanup(book);

  assert.ok(report.categoryCounts.addressesAndHeaders >= 4, 'Should detect vtbook, http, dividers, page numbers, redundant title');
  assert.ok(report.categoryCounts.typosAndCensored >= 3, 'Should detect l*n đ*nh, ci, ko, đc, ng ta');
  // Repeated note appears twice -> 1st copy is preserved, 1 duplicate is flagged!
  assert.equal(report.categoryCounts.repeatedNotes, 1, 'Should preserve 1st copy and flag only the duplicate occurrence');
  assert.ok(report.selectableItems.length >= 6, 'Should produce individual/grouped selectable items');
});

test('applyBookCleanupSelection applies ONLY user-checked categories and keeps 1 original copy of repeated lines', () => {
  const book = makeSampleDirtyBook();
  const report = scanBookForCleanup(book);

  // Case A: User checks ONLY Category 1 (addresses) and Category 2 (typos), leaves Category 3 (repeated notes) UNCHECKED
  const partial = applyBookCleanupSelection(book, report, {
    addressesAndHeaders: true,
    typosAndCensored: true,
    repeatedNotes: false,
  });

  const ch1Text = partial.cleanedBook.chapters[0].paragraphs.join('\n');
  const ch2Text = partial.cleanedBook.chapters[1].paragraphs.join('\n');

  assert.equal(ch1Text.includes('vtbook'), false, 'vtbook address must be removed');
  assert.equal(ch1Text.includes('https://'), false, 'http URL must be removed');
  assert.equal(ch1Text.includes('---'), false, 'divider must be removed');
  assert.equal(ch1Text.includes('lên đỉnh núi'), true, 'l*n đ*nh núi must be restored to lên đỉnh núi');
  assert.equal(ch1Text.includes('chị ấy'), true, 'ci ấy must be fixed to chị ấy');
  assert.equal(ch1Text.includes('không nghĩ'), true, 'ko must be fixed to không');
  assert.equal(ch1Text.includes('được xa'), true, 'đc must be fixed to được');
  assert.equal(ch2Text.includes('Gọi chị ra đây'), true, 'Gọi ci must be fixed to Gọi chị');
  // Category 3 unchecked -> both copies of repeated note MUST still be preserved!
  const partialMatches = partial.cleanedBook.chapters
    .flatMap((c) => c.paragraphs)
    .filter((p) => p.includes('[Chú thích:'));
  assert.equal(partialMatches.length, 2, 'Unchecked Category 3 must remain intact');

  // Case B: User checks ALL 3 categories -> keeps 1st copy of repeated note, deletes only the duplicate!
  const full = applyBookCleanupSelection(book, report, {
    addressesAndHeaders: true,
    typosAndCensored: true,
    repeatedNotes: true,
  });
  const fullNoteMatches = full.cleanedBook.chapters
    .flatMap((c) => c.paragraphs)
    .filter((p) => p.includes('[Chú thích:'));
  assert.equal(fullNoteMatches.length, 1, 'Mandatory rule: MUST preserve 1 original copy and remove only duplicates');
  assert.ok(full.removedCount >= 5);
  assert.ok(full.fixedCount >= 3);
});

test('Mandatory deduplication rule: 50 identical repeated paragraphs keeps exact 1 original copy at 1st position and deletes 49 duplicates', () => {
  const repeatedLine = 'Ánh trăng bàng bạc phủ xuống mặt hồ tĩnh lặng giữa rừng sâu.';
  const paragraphs: string[] = [
    'Mở đầu câu chuyện.',
    ...Array.from({ length: 50 }, () => repeatedLine),
    'Đoạn kết câu chuyện.',
  ];
  const book: Book = {
    id: 'dup-50-book',
    title: 'Trăng Rừng',
    author: 'Test',
    description: '',
    language: 'vi',
    sourceType: 'epub',
    chapters: [{ id: 'ch-1', index: 0, title: 'Chương 1', paragraphs }],
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent: 0,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt: 1,
    lastReadAt: 1,
  };

  const report = scanBookForCleanup(book);
  assert.equal(report.selectableItems.length, 1);
  const dupItem = report.selectableItems[0];
  assert.equal(dupItem.repeatTotalCount, 50);
  assert.equal(dupItem.duplicateRemoveCount, 49);
  assert.ok(dupItem.label.includes('lặp 50 lần'));
  assert.ok(dupItem.label.includes('giữ 1 bản gốc'));
  assert.ok(dupItem.label.includes('xóa 49 bản thừa'));

  const result = applyBookCleanupByItemIds(book, report, new Set([dupItem.id]));
  assert.equal(result.removedCount, 49);
  const outParas = result.cleanedBook.chapters[0].paragraphs;
  assert.deepEqual(outParas, [
    'Mở đầu câu chuyện.',
    repeatedLine,
    'Đoạn kết câu chuyện.',
  ]);
});

test('applyBookCleanupByItemIds deletes ONLY checked individual lines and leaves unchecked lines untouched', () => {
  const book = makeSampleDirtyBook();
  const report = scanBookForCleanup(book);
  const firstJunkItem = report.selectableItems.find((it) => it.excerpt.includes('vtbook'));
  const dividerItem = report.selectableItems.find((it) => it.excerpt.includes('---'));
  assert.ok(firstJunkItem && dividerItem);

  const res = applyBookCleanupByItemIds(book, report, new Set([firstJunkItem.id]));
  const ch1Text = res.cleanedBook.chapters[0].paragraphs.join('\n');
  assert.equal(ch1Text.includes('https://vtbook.vn'), false, 'Checked vtbook line must be removed');
  assert.equal(ch1Text.includes('---------------'), true, 'Unchecked divider line must remain untouched');
});

test('mergeAiBookFindings integrates Gemini AI contextual repairs cleanly without duplicates', () => {
  const book = makeSampleDirtyBook();
  const base = scanBookForCleanup(book);
  const merged = mergeAiBookFindings(base, [
    {
      id: 'ai-1',
      category: 'typosAndCensored',
      chapterIndex: 0,
      paragraphIndex: 1,
      action: 'replace',
      original: book.chapters[0].paragraphs[1],
      cleaned: 'Hôm nay chị ấy cùng cả đoàn leo lên đỉnh núi trong sương sớm.',
      reason: 'AI hiệu đính chính tả & từ bị che',
    },
  ]);

  assert.equal(merged.usedAiBoost, true);
  assert.equal(merged.categoryCounts.typosAndCensored, base.categoryCounts.typosAndCensored);
});

test('Pre-Read AI lookahead skips pure vtbook/http/footer paragraphs and fixes masked words for the AI Reader', () => {
  const book = makeSampleDirtyBook();
  const repeated = collectRepeatedLineSignatures(book.chapters);

  const d0 = evaluateParagraphForPreRead(book.chapters[0].paragraphs[0], 0, book.title, repeated);
  assert.equal(d0.action, 'skip', 'vtbook/http line must be skipped before AI Voice Reader');

  const d1 = evaluateParagraphForPreRead(book.chapters[0].paragraphs[1], 1, book.title, repeated);
  assert.equal(d1.action, 'fix');
  assert.equal(d1.cleanedText, 'Hôm nay chị ấy cùng cả đoàn leo lên đỉnh núi trong sương sớm.');

  const d2 = evaluateParagraphForPreRead(book.chapters[0].paragraphs[2], 2, book.title, repeated);
  assert.equal(d2.action, 'skip', 'separator line must be skipped');

  const d4 = evaluateParagraphForPreRead(book.chapters[0].paragraphs[4], 4, book.title, repeated);
  assert.equal(d4.action, 'skip', 'repeated footnote must be skipped');

  // Verify batch resolution skips pure-junk batch completely
  const decisions = new Map([
    [0, d0],
    [1, d1],
  ]);
  const junkBatch = resolveBatchSpeechWithPreRead(
    [{ paragraphIndex: 0, text: book.chapters[0].paragraphs[0] }],
    decisions,
    book.title,
    repeated
  );
  assert.equal(junkBatch.shouldSkipBatch, true);
  assert.ok(junkBatch.skipReason && junkBatch.skipReason.length > 0);

  // Verify mixed batch drops junk span and speaks repaired prose cleanly
  const mixedBatch = resolveBatchSpeechWithPreRead(
    [
      { paragraphIndex: 0, text: book.chapters[0].paragraphs[0] },
      { paragraphIndex: 1, text: book.chapters[0].paragraphs[1] },
    ],
    decisions,
    book.title,
    repeated
  );
  assert.equal(mixedBatch.shouldSkipBatch, false);
  assert.equal(
    mixedBatch.spokenText,
    'Hôm nay chị ấy cùng cả đoàn leo lên đỉnh núi trong sương sớm.'
  );
  assert.equal(mixedBatch.skippedCount, 1);
  assert.equal(mixedBatch.fixedCount, 1);
});

test('Unicode-safe Vietnamese boundaries never corrupt "Ông ta" or "Lòng ta" while still fixing standalone "ng ta"', () => {
  const cleanBook: Book = {
    ...makeSampleDirtyBook(),
    id: 'test-clean-book',
    title: 'Sách sạch',
    chapters: [
      {
        id: 'ch-clean',
        index: 0,
        title: 'Chương 1',
        paragraphs: [
          'Ông ta cúi chào trịnh trọng rồi bước đi.',
          'Lòng ta bỗng thấy bình yên dưới ánh trăng.',
          'Tiếng ta vang vọng giữa thung lũng sâu.',
        ],
      },
    ],
  };

  const cleanReport = scanBookForCleanup(cleanBook);
  assert.equal(cleanReport.totalIssues, 0);

  const abbrBook: Book = {
    ...cleanBook,
    id: 'test-abbr-book',
    chapters: [
      {
        id: 'ch-abbr',
        index: 0,
        title: 'Chương 1',
        paragraphs: ['Hôm qua ng ta ko đến đc vì trời mưa.'],
      },
    ],
  };

  const abbrReport = scanBookForCleanup(abbrBook);
  assert.equal(abbrReport.totalIssues, 1);
  const cleaned = applyBookCleanupSelection(abbrBook, abbrReport, {
    addressesAndHeaders: true,
    typosAndCensored: true,
    repeatedNotes: true,
  });
  assert.equal(
    cleaned.cleanedBook.chapters[0].paragraphs[0],
    'Hôm qua người ta không đến được vì trời mưa.'
  );
});

