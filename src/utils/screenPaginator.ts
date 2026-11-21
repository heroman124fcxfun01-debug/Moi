import type { ReaderSettings } from '../types/book';
import type { BilingualParagraphPair } from './textProcessing';

export interface ScreenPageChunk {
  paragraphIndex: number;
  charOffset?: number;
  original: string;
  translated: string | null;
  isFirstOfParagraph: boolean;
  isContinuation: boolean;
}

export interface ScreenPage {
  pageIndex: number;
  chunks: ScreenPageChunk[];
  hasChapterHeader: boolean;
}

export interface ViewportPaginationInput {
  paragraphs: BilingualParagraphPair[];
  chapterTitle: string;
  viewportWidth: number;
  viewportHeight: number;
  settings: Pick<
    ReaderSettings,
    | 'fontFamily'
    | 'fontSize'
    | 'lineHeight'
    | 'paragraphSpacing'
    | 'letterSpacing'
    | 'fontWeight'
    | 'firstLineIndent'
    | 'dropCap'
    | 'columnsInPaginated'
  >;
}

let cachedMeasureCanvas: HTMLCanvasElement | null = null;

function createTextWidthMeasurer(
  fontSize: number,
  fontWeight: number,
  fontFamily: string,
  letterSpacingEm: number
): (text: string) => number {
  const extraPerChar = fontSize * (letterSpacingEm || 0);

  if (typeof document !== 'undefined') {
    try {
      if (!cachedMeasureCanvas) {
        cachedMeasureCanvas = document.createElement('canvas');
      }
      const ctx = cachedMeasureCanvas.getContext('2d');
      if (ctx) {
        const cleanFamily = fontFamily || 'Georgia, serif';
        ctx.font = `${fontWeight || 400} ${fontSize}px ${cleanFamily}`;
        return (text: string) => {
          if (!text) return 0;
          const base = ctx.measureText(text).width;
          // Apply realistic 1.12 safety factor for Vietnamese diacritics, justified spacing & WebView webfonts
          return base * 1.12 + Math.max(0, text.length - 1) * extraPerChar;
        };
      }
    } catch {
      // Fall back to deterministic metric in headless/test environments
    }
  }

  // Deterministic fallback for Node.js tests & environments without Canvas 2D
  return (text: string) => {
    let width = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ') {
        width += fontSize * 0.29;
      } else if ('iljtI1.,;:\'"!|'.includes(ch)) {
        width += fontSize * 0.36;
      } else if ('mwMW@%'.includes(ch)) {
        width += fontSize * 0.85;
      } else {
        width += fontSize * 0.58;
      }
    }
    return width + Math.max(0, text.length - 1) * extraPerChar;
  };
}

/**
 * Splits a single text block into wrapped visual lines that fit within `maxLineWidth`.
 */
export function wrapTextToLines(
  text: string,
  maxLineWidth: number,
  measureWidth: (s: string) => number,
  firstLineIndentPx = 0,
  dropCapReservePx = 0
): string[] {
  const clean = text.trim();
  if (!clean) return [];

  const safeWidth = Math.max(120, maxLineWidth);
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  const getAvailWidth = (lineIndex: number) => {
    if (dropCapReservePx > 0 && lineIndex < 3) {
      return Math.max(72, safeWidth - dropCapReservePx);
    }
    return lineIndex === 0 ? Math.max(80, safeWidth - firstLineIndentPx) : safeWidth;
  };

  for (const word of words) {
    const avail = getAvailWidth(lines.length);
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (measureWidth(candidate) <= avail) {
      currentLine = candidate;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
      currentLine = '';
    }

    // Handle extraordinarily long unbroken tokens (URLs / long strings)
    const nextAvail = getAvailWidth(lines.length);
    if (measureWidth(word) <= nextAvail) {
      currentLine = word;
    } else {
      let piece = '';
      for (const ch of word) {
        const nextPiece = piece + ch;
        if (piece && measureWidth(nextPiece) > nextAvail) {
          lines.push(piece);
          piece = ch;
        } else {
          piece = nextPiece;
        }
      }
      currentLine = piece;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Paginates chapter paragraphs into exact screen-fitted pages based on real viewport
 * dimensions and active reader typography settings (fontSize, lineHeight, paragraphSpacing, etc.).
 * Changing font size or resizing the phone viewport dynamically recalculates total pages.
 */
export function paginateChapterForViewport(input: ViewportPaginationInput): ScreenPage[] {
  const { paragraphs, chapterTitle, viewportWidth, viewportHeight, settings } = input;
  if (paragraphs.length === 0) {
    return [{ pageIndex: 0, chunks: [], hasChapterHeader: true }];
  }

  const fontSize = Math.max(12, Math.min(40, settings.fontSize || 19));
  const lineHeight = Math.max(1.2, Math.min(2.6, settings.lineHeight || 1.8));
  const lineHeightPx = fontSize * lineHeight;
  const paraSpacingPx = Math.max(6, Math.min(44, settings.paragraphSpacing ?? 18));
  const columns = settings.columnsInPaginated === 2 && viewportWidth >= 768 ? 2 : 1;
  const colGap = columns === 2 ? 40 : 0;

  // Inner column text width (subtracting horizontal paragraph padding px-1.5 + safety margin)
  const effectiveColumnWidth = Math.max(
    160,
    (Math.max(200, viewportWidth) - colGap) / columns - 26
  );

  // Available vertical text height per column (generous bottom clearance so text ALWAYS sits visibly above the 3 footer buttons)
  const safetyBuffer = Math.max(36, lineHeightPx * 1.4);
  const singleColumnBudget = Math.max(lineHeightPx * 2, viewportHeight - safetyBuffer);
  const fullPageBudget = singleColumnBudget * columns;

  const measureWidth = createTextWidthMeasurer(
    fontSize,
    settings.fontWeight || 400,
    settings.fontFamily,
    settings.letterSpacing || 0
  );

  // Compact half-size chapter header on Page 1 (9px eyebrow + 11–13px title + compact mb-2 pb-1.5)
  const titleFontSize = viewportWidth >= 640 ? 13 : 11;
  const titleCharsPerLine = Math.max(16, Math.floor(Math.max(200, viewportWidth) / (titleFontSize * 0.62)));
  const titleLines = Math.max(1, Math.min(2, Math.ceil((chapterTitle || '').length / titleCharsPerLine)));
  const chapterHeaderHeight = 18 + titleLines * (titleFontSize * 1.35) + 18;

  const pages: ScreenPage[] = [];
  let currentChunks: ScreenPageChunk[] = [];
  let isFirstPage = true;
  let remainingHeight = Math.max(lineHeightPx * 2, fullPageBudget - chapterHeaderHeight);

  const flushPage = () => {
    pages.push({
      pageIndex: pages.length,
      chunks: currentChunks,
      hasChapterHeader: isFirstPage,
    });
    currentChunks = [];
    isFirstPage = false;
    remainingHeight = fullPageBudget;
  };

  for (const pair of paragraphs) {
    const useDropCap = settings.dropCap && pair.index === 0;
    const indentPx = settings.firstLineIndent && !useDropCap ? 28 : 0;
    const dropCapReservePx = useDropCap ? Math.min(effectiveColumnWidth * 0.36, fontSize * 2.35) : 0;
    const wrappedOriginal = wrapTextToLines(
      pair.original,
      effectiveColumnWidth,
      measureWidth,
      indentPx,
      dropCapReservePx
    );

    const wrappedTranslated = pair.translated
      ? wrapTextToLines(
          pair.translated,
          Math.max(140, effectiveColumnWidth - 16),
          createTextWidthMeasurer(
            fontSize * 0.92,
            settings.fontWeight || 400,
            settings.fontFamily,
            settings.letterSpacing || 0
          ),
          0
        )
      : [];

    const translatedHeight =
      wrappedTranslated.length > 0
        ? wrappedTranslated.length * (lineHeightPx * 0.92) + 10
        : 0;

    // If paragraph is empty, skip cleanly
    if (wrappedOriginal.length === 0 && wrappedTranslated.length === 0) continue;

    // Pack original lines across one or more screen pages so long paragraphs never overflow off-screen
    let lineOffset = 0;
    let chunkPartIndex = 0;
    let charOffset = 0;

    while (lineOffset < wrappedOriginal.length) {
      const dropCapExtra = useDropCap && chunkPartIndex === 0 ? lineHeightPx * 0.45 : 0;
      const minLinesNeeded = 1;
      const minChunkHeight = minLinesNeeded * lineHeightPx + dropCapExtra;

      if (currentChunks.length > 0 && remainingHeight < minChunkHeight + 4) {
        flushPage();
      }

      const maxLinesThatFit = Math.max(
        1,
        Math.floor((remainingHeight - dropCapExtra - 4) / lineHeightPx)
      );
      const remainingLines = wrappedOriginal.length - lineOffset;
      let takeLines = Math.min(remainingLines, maxLinesThatFit);

      // Avoid leaving a single orphan line if we're starting mid-page and the whole short paragraph fits on a fresh page
      if (
        chunkPartIndex === 0 &&
        currentChunks.length > 0 &&
        takeLines === 1 &&
        remainingLines <= 4 &&
        remainingLines * lineHeightPx + paraSpacingPx + translatedHeight <= fullPageBudget
      ) {
        flushPage();
        continue;
      }

      const isLastSliceOfOriginal = lineOffset + takeLines >= wrappedOriginal.length;

      // Attach translation to the final slice of the paragraph (or bump if it doesn't fit)
      let includeTranslation = isLastSliceOfOriginal && wrappedTranslated.length > 0;
      const chunkContentHeight = takeLines * lineHeightPx + dropCapExtra + 6;

      if (includeTranslation && chunkContentHeight + translatedHeight > remainingHeight) {
        // If we already took multiple lines, leave 1 line with translation on next page if possible
        if (takeLines > 2) {
          takeLines -= 1;
          includeTranslation = false;
        } else if (currentChunks.length > 0) {
          flushPage();
          continue;
        }
      }

      const finalSliceText = wrappedOriginal.slice(lineOffset, lineOffset + takeLines).join(' ');
      const finalIsLast = lineOffset + takeLines >= wrappedOriginal.length;
      const attachTrans = finalIsLast && wrappedTranslated.length > 0 ? pair.translated : null;

      currentChunks.push({
        paragraphIndex: pair.index,
        charOffset,
        original: finalSliceText,
        translated: attachTrans,
        isFirstOfParagraph: chunkPartIndex === 0,
        isContinuation: chunkPartIndex > 0,
      });

      const consumed =
        takeLines * lineHeightPx +
        dropCapExtra +
        6 +
        (attachTrans ? translatedHeight : 0) +
        paraSpacingPx;

      remainingHeight = Math.max(0, remainingHeight - consumed);
      lineOffset += takeLines;
      charOffset += finalSliceText.length + 1;
      chunkPartIndex += 1;

      if (lineOffset < wrappedOriginal.length) {
        flushPage();
      }
    }
  }

  if (currentChunks.length > 0 || pages.length === 0) {
    flushPage();
  }

  return pages;
}

/**
 * Finds the screen page index containing a given paragraph index.
 */
export function findScreenPageForParagraph(
  pages: ScreenPage[],
  paragraphIndex: number
): number {
  if (pages.length === 0) return 0;
  const idx = pages.findIndex((pg) =>
    pg.chunks.some((c) => c.paragraphIndex === paragraphIndex)
  );
  if (idx >= 0) return idx;
  // Find nearest preceding page if exact paragraph wasn't found
  for (let i = pages.length - 1; i >= 0; i--) {
    const first = pages[i].chunks[0];
    if (first && first.paragraphIndex <= paragraphIndex) return i;
  }
  return 0;
}

export interface ExactReadingPosition {
  paragraphIndex: number;
  charOffset?: number;
  pageIndex?: number;
}

/**
 * Resolves the exact screen page for a saved reading position, supporting both:
 * 1. Exact saved `pageIndex` when the page still holds the saved paragraph/offset (zero drift on reopen).
 * 2. Exact `charOffset` inside multi-page paragraphs (so exiting on page 18 of a 30-page chapter
 *    never snaps back to page 0 even if font size or viewport height changes).
 */
export function findScreenPageForPosition(
  pages: ScreenPage[],
  pos: ExactReadingPosition
): number {
  if (pages.length === 0) return 0;
  const maxPageIdx = pages.length - 1;
  const targetPara = Math.max(0, pos.paragraphIndex || 0);
  const hasCharOffset = typeof pos.charOffset === 'number' && pos.charOffset > 0;
  const targetOffset = hasCharOffset ? pos.charOffset! : 0;

  // 1. If we have a saved charOffset inside a paragraph, match the exact chunk spanning that offset
  if (hasCharOffset) {
    let bestPage = -1;
    let bestDelta = Number.POSITIVE_INFINITY;

    for (let pIdx = 0; pIdx < pages.length; pIdx++) {
      for (const chunk of pages[pIdx].chunks) {
        if (chunk.paragraphIndex !== targetPara) continue;
        const start = chunk.charOffset ?? 0;
        const end = start + chunk.original.length + 1;
        // Exact hit inside this chunk's character span
        if (targetOffset >= start && targetOffset < end) {
          return pIdx;
        }
        const delta = Math.abs(start - targetOffset);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestPage = pIdx;
        }
      }
    }

    if (bestPage >= 0) return bestPage;
  }

  // 2. If exact saved pageIndex still contains targetPara (or is a valid page when no charOffset), prefer it
  if (typeof pos.pageIndex === 'number' && pos.pageIndex >= 0) {
    const clampedSaved = Math.min(pos.pageIndex, maxPageIdx);
    const savedPage = pages[clampedSaved];
    if (
      savedPage &&
      (savedPage.chunks.some((c) => c.paragraphIndex === targetPara) ||
        (targetPara === 0 && clampedSaved > 0 && savedPage.chunks.length > 0))
    ) {
      return clampedSaved;
    }
  }

  // 3. Fallback to paragraph lookup
  return findScreenPageForParagraph(pages, targetPara);
}

export interface BookPaginationChapterInput {
  title: string;
  paragraphs: BilingualParagraphPair[];
}

export interface BookScreenPaginationSummary {
  chapterPageCounts: number[];
  chapterStartPageOffsets: number[];
  totalBookPages: number;
}

/**
 * Dynamically recalculates total screen-fitted display pages across ALL chapters in the book
 * whenever fontSize, lineHeight, fontFamily, or viewport dimensions change.
 * Example: Original EPUB content A..Z automatically splits into screen pages A..C, C..E, E..G...
 * and every page turn advances cleanly across those recalculated display pages.
 */
export function computeBookScreenPaginationSummary(input: {
  chapters: BookPaginationChapterInput[];
  currentChapterIndex: number;
  currentChapterPageCount: number;
  viewportWidth: number;
  viewportHeight: number;
  settings: ViewportPaginationInput['settings'];
}): BookScreenPaginationSummary {
  const {
    chapters,
    currentChapterIndex,
    currentChapterPageCount,
    viewportWidth,
    viewportHeight,
    settings,
  } = input;

  const chapterPageCounts: number[] = [];
  const chapterStartPageOffsets: number[] = [];
  let runningOffset = 0;

  for (let i = 0; i < chapters.length; i++) {
    chapterStartPageOffsets.push(runningOffset);
    let count: number;
    if (i === currentChapterIndex && currentChapterPageCount > 0) {
      count = currentChapterPageCount;
    } else {
      const ch = chapters[i];
      count = Math.max(
        1,
        paginateChapterForViewport({
          paragraphs: ch.paragraphs,
          chapterTitle: ch.title,
          viewportWidth,
          viewportHeight,
          settings,
        }).length
      );
    }
    chapterPageCounts.push(count);
    runningOffset += count;
  }

  return {
    chapterPageCounts,
    chapterStartPageOffsets,
    totalBookPages: Math.max(1, runningOffset),
  };
}

/**
 * Maps a 1-based global display page number (1 .. totalBookPages) back to its exact
 * (chapterIndex, pageIndex) inside the book so tapping the page indicator jumps cleanly.
 */
export function resolveLocationForGlobalPage(
  summary: BookScreenPaginationSummary,
  globalPage1Based: number
): { chapterIndex: number; pageIndex: number } {
  const clampedGlobal = Math.max(
    1,
    Math.min(Math.max(1, summary.totalBookPages), Math.round(globalPage1Based))
  );
  const zeroBased = clampedGlobal - 1;
  for (let chIdx = summary.chapterStartPageOffsets.length - 1; chIdx >= 0; chIdx--) {
    const start = summary.chapterStartPageOffsets[chIdx];
    if (zeroBased >= start) {
      const maxPageInCh = Math.max(0, (summary.chapterPageCounts[chIdx] || 1) - 1);
      return {
        chapterIndex: chIdx,
        pageIndex: Math.min(maxPageInCh, zeroBased - start),
      };
    }
  }
  return { chapterIndex: 0, pageIndex: 0 };
}

