import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findScreenPageForPosition,
  paginateChapterForViewport,
} from './screenPaginator';
import type { BilingualParagraphPair } from './textProcessing';

const BASE_SETTINGS = {
  fontFamily: 'Georgia, serif',
  fontSize: 19,
  lineHeight: 1.8,
  paragraphSpacing: 16,
  letterSpacing: 0,
  fontWeight: 400,
  firstLineIndent: true,
  dropCap: false,
  columnsInPaginated: 1 as const,
};

describe('screenPaginator exact page resume', () => {
  it('restores exact exit page inside a long 20+ page single-paragraph chapter without jumping to page 0', () => {
    // Simulate a PDF/OCR chapter parsed as 1 giant paragraph spanning 20+ screen pages
    const sentences: string[] = [];
    for (let i = 1; i <= 240; i++) {
      sentences.push(
        `Đoạn văn dài số ${i} kể lại hành trình vượt qua những ngọn núi mù sương trong đêm lạnh giá của mùa đông.`
      );
    }
    const paragraphs: BilingualParagraphPair[] = [
      { index: 0, original: sentences.join(' '), translated: null },
    ];

    const pages = paginateChapterForViewport({
      paragraphs,
      chapterTitle: 'Chương 1: Hành trình dài',
      viewportWidth: 358,
      viewportHeight: 620,
      settings: BASE_SETTINGS,
    });

    assert.ok(pages.length >= 15, `Expected >= 15 pages, got ${pages.length}`);

    // User exits on page index 12 (Trang 13)
    const exitPageIdx = 12;
    const exitChunk = pages[exitPageIdx].chunks[0];
    assert.equal(exitChunk.paragraphIndex, 0);
    assert.ok((exitChunk.charOffset ?? 0) > 0, 'Chunk on page 13 must have positive charOffset');

    // Reopening at same viewport restores EXACTLY page 12 (never page 0!)
    const resumedSameViewport = findScreenPageForPosition(pages, {
      paragraphIndex: exitChunk.paragraphIndex,
      charOffset: exitChunk.charOffset,
      pageIndex: exitPageIdx,
    });
    assert.equal(resumedSameViewport, exitPageIdx);

    // Reopening after slight viewport height change (e.g. mobile address bar / ResizeObserver)
    // still lands on the exact page holding that charOffset (nowhere near page 0!)
    const resizedPages = paginateChapterForViewport({
      paragraphs,
      chapterTitle: 'Chương 1: Hành trình dài',
      viewportWidth: 358,
      viewportHeight: 660,
      settings: BASE_SETTINGS,
    });
    const resumedResized = findScreenPageForPosition(resizedPages, {
      paragraphIndex: exitChunk.paragraphIndex,
      charOffset: exitChunk.charOffset,
      pageIndex: exitPageIdx,
    });
    assert.ok(resumedResized >= 9, `Expected resumed page >= 9 after resize, got ${resumedResized}`);
    const landedChunk = resizedPages[resumedResized].chunks.find(
      (c) => c.paragraphIndex === 0
    );
    assert.ok(landedChunk);
    const start = landedChunk!.charOffset ?? 0;
    const end = start + landedChunk!.original.length + 1;
    assert.ok(
      (exitChunk.charOffset ?? 0) >= start && (exitChunk.charOffset ?? 0) < end,
      `Expected saved charOffset ${exitChunk.charOffset} to fall inside [${start}, ${end})`
    );
  });

  it('restores exact exit page in a multi-paragraph 30-page chapter', () => {
    const paragraphs: BilingualParagraphPair[] = Array.from({ length: 65 }, (_, i) => ({
      index: i,
      original: `Đoạn ${i + 1}: Mặt trời dần khuất sau rặng núi phía tây, để lại những vệt mây đỏ rực trên bầu trời rộng lớn. Tiếng gió thổi qua rừng thông xào xạc như lời thì thầm của quá khứ xa xôi vọng về.`,
      translated: null,
    }));

    const pages = paginateChapterForViewport({
      paragraphs,
      chapterTitle: 'Chương 5: Bóng chiều',
      viewportWidth: 358,
      viewportHeight: 600,
      settings: BASE_SETTINGS,
    });

    assert.ok(pages.length >= 12, `Expected >= 12 pages, got ${pages.length}`);
    const exitIdx = Math.min(pages.length - 2, 10);
    const exitChunk = pages[exitIdx].chunks[0];

    const resumed = findScreenPageForPosition(pages, {
      paragraphIndex: exitChunk.paragraphIndex,
      charOffset: exitChunk.charOffset,
      pageIndex: exitIdx,
    });
    assert.equal(resumed, exitIdx);
  });

  it('reflows overflowed text onto additional screen pages when fontSize increases with zero word loss', () => {
    const paragraphs: BilingualParagraphPair[] = Array.from({ length: 18 }, (_, i) => ({
      index: i,
      original: `Đoạn văn thứ ${i + 1}: Ánh đèn vàng ấm áp rọi qua khung cửa sổ nhỏ, phản chiếu những trang giấy thơm mùi gỗ cũ giữa đêm mưa rơi rả rích bên hiên nhà.`,
      translated: null,
    }));

    const smallPages = paginateChapterForViewport({
      paragraphs,
      chapterTitle: 'Chương 2: Đêm Mưa',
      viewportWidth: 358,
      viewportHeight: 620,
      settings: { ...BASE_SETTINGS, fontSize: 16, dropCap: true },
    });

    const largePages = paginateChapterForViewport({
      paragraphs,
      chapterTitle: 'Chương 2: Đêm Mưa',
      viewportWidth: 358,
      viewportHeight: 620,
      settings: { ...BASE_SETTINGS, fontSize: 28, dropCap: true },
    });

    assert.ok(
      largePages.length > smallPages.length * 1.5,
      `Expected large font pages (${largePages.length}) to be much greater than small font pages (${smallPages.length})`
    );

    // Every single word across all paragraphs must be preserved across largePages
    const expectedWords = paragraphs
      .map((p) => p.original.trim())
      .join(' ')
      .split(/\s+/);
    const actualWords = largePages
      .flatMap((page) => page.chunks.map((c) => c.original.trim()))
      .join(' ')
      .split(/\s+/);
    assert.deepEqual(actualWords, expectedWords);
  });
});

