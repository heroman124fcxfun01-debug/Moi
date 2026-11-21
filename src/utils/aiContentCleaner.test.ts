import test from 'node:test';
import assert from 'node:assert/strict';
import {
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

test('aiContentCleaner classifies vtbook/http/dividers, censored/typos (l*n đ*nh, ci), and repeated notes into 3 categories', () => {
  const book = makeSampleDirtyBook();
  const report = scanBookForCleanup(book);

  assert.ok(report.categoryCounts.addressesAndHeaders >= 4, 'Should detect vtbook, http, dividers, page numbers, redundant title');
  assert.ok(report.categoryCounts.typosAndCensored >= 3, 'Should detect l*n đ*nh, ci, ko, đc, ng ta');
  assert.ok(report.categoryCounts.repeatedNotes >= 2, 'Should detect repeated [Chú thích: ...] notes');
});

test('applyBookCleanupSelection applies ONLY user-checked categories cleanly', () => {
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
  // Category 3 unchecked -> repeated note MUST still be preserved!
  assert.equal(ch1Text.includes('[Chú thích:'), true, 'Unchecked Category 3 must remain intact');

  // Case B: User checks ALL 3 categories
  const full = applyBookCleanupSelection(book, report, {
    addressesAndHeaders: true,
    typosAndCensored: true,
    repeatedNotes: true,
  });
  const fullText = full.cleanedBook.chapters.flatMap((c) => c.paragraphs).join('\n');
  assert.equal(fullText.includes('[Chú thích:'), false, 'Checked Category 3 repeated notes must be removed');
  assert.ok(full.removedCount >= 6);
  assert.ok(full.fixedCount >= 3);
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
