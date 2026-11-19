import type { Chapter, TranslationMode } from '../types/book';

/**
 * Cleans raw text lines into normalized non-empty paragraphs.
 */
export function cleanExtractedParagraphs(rawText: string): string[] {
  if (!rawText || typeof rawText !== 'string') return [];

  const normalized = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ');

  // Split by blank lines first; if text only has single newlines (like PDF dumps), merge wrapped lines intelligently
  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
    )
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  if (blocks.length > 1) {
    return blocks;
  }

  // Fallback for single-newline separated lines (e.g. OCR / plain text)
  return normalized
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0);
}

/**
 * Splits a list of page texts (e.g. from PDF) into logical chapters.
 * Detects Vietnamese & English chapter headings ("Chương 1", "Chapter 1", "Phần I", etc.)
 * or falls back to grouping every `pagesPerChapter` pages.
 */
export function splitPagesIntoChapters(
  pages: string[],
  fallbackTitlePrefix = 'Phần',
  pagesPerChapter = 8
): Array<{ title: string; paragraphs: string[] }> {
  const chapterHeadingRegex =
    /^(chương\s+\d+|chương\s+[ivxlcdm]+|chapter\s+\d+|chapter\s+[ivxlcdm]+|phần\s+\d+|hồi\s+\d+|mục\s+\d+)/i;

  const detectedChapters: Array<{ title: string; paragraphs: string[] }> = [];
  let currentTitle = `${fallbackTitlePrefix} 1`;
  let currentParagraphs: string[] = [];

  const allParagraphs = pages.flatMap((pageText) => cleanExtractedParagraphs(pageText));

  const hasExplicitHeadings = allParagraphs.some(
    (p) => p.length < 90 && chapterHeadingRegex.test(p)
  );

  if (hasExplicitHeadings) {
    for (const para of allParagraphs) {
      if (para.length < 90 && chapterHeadingRegex.test(para)) {
        if (currentParagraphs.length > 0) {
          detectedChapters.push({
            title: currentTitle,
            paragraphs: currentParagraphs,
          });
        }
        currentTitle = para;
        currentParagraphs = [];
      } else {
        currentParagraphs.push(para);
      }
    }
    if (currentParagraphs.length > 0) {
      detectedChapters.push({
        title: currentTitle,
        paragraphs: currentParagraphs,
      });
    }
    return detectedChapters;
  }

  // Otherwise group by page chunks
  for (let i = 0; i < pages.length; i += pagesPerChapter) {
    const chunk = pages.slice(i, i + pagesPerChapter);
    const paras = chunk.flatMap((p) => cleanExtractedParagraphs(p));
    if (paras.length > 0) {
      const startPage = i + 1;
      const endPage = Math.min(i + pagesPerChapter, pages.length);
      detectedChapters.push({
        title:
          startPage === endPage
            ? `${fallbackTitlePrefix} ${detectedChapters.length + 1} (Trang ${startPage})`
            : `${fallbackTitlePrefix} ${detectedChapters.length + 1} (Trang ${startPage}–${endPage})`,
        paragraphs: paras,
      });
    }
  }

  if (detectedChapters.length === 0) {
    return [{ title: `${fallbackTitlePrefix} 1`, paragraphs: ['(Tài liệu chưa có nội dung văn bản trích xuất được.)'] }];
  }

  return detectedChapters;
}

export interface BilingualParagraphPair {
  index: number;
  original: string;
  translated: string | null;
}

/**
 * Aligns original chapter paragraphs with cached translation paragraphs
 * according to the active TranslationMode.
 */
export function buildRenderedParagraphs(
  chapter: Chapter,
  mode: TranslationMode,
  targetLang: string
): BilingualParagraphPair[] {
  const translatedList = chapter.translations?.[targetLang]?.paragraphs ?? [];

  return chapter.paragraphs.map((orig, index) => {
    const trans = translatedList[index] ?? null;
    if (mode === 'original') {
      return { index, original: orig, translated: null };
    }
    if (mode === 'override') {
      return {
        index,
        original: trans && trans.trim().length > 0 ? trans : orig,
        translated: null,
      };
    }
    // bilingual
    return {
      index,
      original: orig,
      translated: trans && trans.trim().length > 0 ? trans : null,
    };
  });
}

/**
 * Paginates paragraphs into pages with approximately `maxWordsPerPage` words per page.
 */
export function paginateParagraphs(
  paragraphs: BilingualParagraphPair[],
  maxWordsPerPage = 260
): BilingualParagraphPair[][] {
  if (paragraphs.length === 0) return [[]];

  const pages: BilingualParagraphPair[][] = [];
  let currentPage: BilingualParagraphPair[] = [];
  let currentWords = 0;

  for (const item of paragraphs) {
    const words =
      countWords(item.original) + (item.translated ? countWords(item.translated) : 0);

    if (currentPage.length > 0 && currentWords + words > maxWordsPerPage) {
      pages.push(currentPage);
      currentPage = [item];
      currentWords = words;
    } else {
      currentPage.push(item);
      currentWords += words;
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function estimateBookStats(chapters: Chapter[]): {
  totalWords: number;
  estimatedMinutes: number;
  chapterCount: number;
} {
  let totalWords = 0;
  for (const ch of chapters) {
    for (const p of ch.paragraphs) {
      totalWords += countWords(p);
    }
  }
  const estimatedMinutes = Math.max(1, Math.ceil(totalWords / 220));
  return {
    totalWords,
    estimatedMinutes,
    chapterCount: chapters.length,
  };
}

export function computeReadingProgress(
  chapters: Chapter[],
  currentChapterIndex: number,
  currentParagraphIndex: number
): number {
  if (chapters.length === 0) return 0;
  const totalParagraphs = chapters.reduce((sum, ch) => sum + Math.max(1, ch.paragraphs.length), 0);
  if (totalParagraphs <= 1) return 100;

  let readBefore = 0;
  for (let i = 0; i < Math.min(currentChapterIndex, chapters.length); i++) {
    readBefore += Math.max(1, chapters[i].paragraphs.length);
  }
  const activeCh = chapters[currentChapterIndex];
  const clampedPara = activeCh
    ? Math.min(Math.max(0, currentParagraphIndex), Math.max(0, activeCh.paragraphs.length - 1))
    : 0;

  const pct = Math.round(((readBefore + clampedPara + 1) / totalParagraphs) * 100);
  return Math.min(100, Math.max(1, pct));
}
