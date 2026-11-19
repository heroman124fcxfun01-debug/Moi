import type { ReaderSettings } from '../types/book';
import type { BilingualParagraphPair } from './textProcessing';

export interface ScreenPageChunk {
  paragraphIndex: number;
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
          // Apply a small 1.03 safety factor for subpixel kerning & Android WebView font metrics
          return base * 1.03 + Math.max(0, text.length - 1) * extraPerChar;
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
        width += fontSize * 0.28;
      } else if ('iljtI1.,;:\'"!|'.includes(ch)) {
        width += fontSize * 0.34;
      } else if ('mwMW@%'.includes(ch)) {
        width += fontSize * 0.82;
      } else {
        width += fontSize * 0.56;
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
  firstLineIndentPx = 0
): string[] {
  const clean = text.trim();
  if (!clean) return [];

  const safeWidth = Math.max(120, maxLineWidth);
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  const getAvailWidth = (lineIndex: number) =>
    lineIndex === 0 ? Math.max(80, safeWidth - firstLineIndentPx) : safeWidth;

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

  // Inner column text width (subtracting horizontal paragraph padding)
  const effectiveColumnWidth = Math.max(
    180,
    (Math.max(220, viewportWidth) - colGap) / columns - 16
  );

  // Available vertical text height per column (leave ~1.2 lines safety buffer so text never clips on Android WebView)
  const safetyBuffer = Math.max(24, lineHeightPx * 1.15);
  const singleColumnBudget = Math.max(lineHeightPx * 3, viewportHeight - safetyBuffer);
  const fullPageBudget = singleColumnBudget * columns;

  const measureWidth = createTextWidthMeasurer(
    fontSize,
    settings.fontWeight || 400,
    settings.fontFamily,
    settings.letterSpacing || 0
  );

  // Estimate chapter header height on Page 1
  const titleFontSize = viewportWidth >= 640 ? 28 : 22;
  const titleCharsPerLine = Math.max(14, Math.floor(Math.max(220, viewportWidth) / (titleFontSize * 0.56)));
  const titleLines = Math.max(1, Math.ceil((chapterTitle || '').length / titleCharsPerLine));
  const chapterHeaderHeight = 26 + titleLines * (titleFontSize * 1.32) + 22;

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
    const wrappedOriginal = wrapTextToLines(
      pair.original,
      effectiveColumnWidth,
      measureWidth,
      indentPx
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
      const sliceText = wrappedOriginal.slice(lineOffset, lineOffset + takeLines).join(' ');

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
        (finalIsLast ? paraSpacingPx : 6);

      remainingHeight = Math.max(0, remainingHeight - consumed);
      lineOffset += takeLines;
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
