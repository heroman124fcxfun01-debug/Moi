import type { Book, Chapter } from '../types/book';

const JUNK_LINE_PATTERNS: RegExp[] = [
  /scale\s*=\s*1\.0|maximum-scale\s*=\s*1\.0|minimum-scale\s*=\s*1\.0|user-scalable\s*=\s*no|viewport/i,
  /fonts\.googleapis\.com|fonts\.gstatic\.com|href\s*=\s*["']https?:\/\//i,
  /<\s*(meta|link|script|style|head|iframe|noscript)\b/i,
  /^\s*(dtv-ebook|dtv\s*ebook|tải\s*từ\s*web|nguồn\s*:\s*.*|sưu\s*tầm\s*từ|bản\s*quyền\s*thuộc|chúc\s*bạn\s*đọc\s*truyện\s*vui\s*vẻ)/i,
  /\b(dtv-ebook\.com|truyenfull\.vn|truyenfull\.com|wikidich|tangthuvien|sstruyen|metruyenchu|thichtruyen|webtruyen)\b/i,
  /^(chương\s*(tiếp|trước|sau)|trang\s*(tiếp|trước|sau)|next\s*chapter|previous\s*chapter|mời\s*đón\s*đọc|quảng\s*cáo|advertisement|chia\s*sẻ\s*lên\s*facebook|bình\s*luận\s*bên\s*dưới|đọc\s*truyện\s*online|tải\s*ebook\s*miễn\s*phí)[.!:\s]*$/i,
  /^[\s\-_=*~•·|<>]{3,}$/,
  /^(width\s*=\s*device-width|initial-scale\s*=\s*1|charset\s*=\s*utf-?8)/i,
  /data-cloudflare|cloudflare|gtag\(|adsbygoogle|window\.dataLayer/i,
];

const INLINE_JUNK_SNIPPETS: RegExp[] = [
  /<[^>]+>/g,
  /\s*\[\s*(dtv-ebook|nguồn:[^\]]+|quảng cáo)\s*\]\s*/gi,
  /\bhttps?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|www\.dtv-ebook\.com|dtv-ebook\.com)[^\s"']*/gi,
  /(?:width=device-width,\s*)?(?:initial-scale|maximum-scale|minimum-scale)=[0-9.]+(?:,\s*user-scalable=\w+)?/gi,
];

/**
 * Checks whether a line/paragraph is HTML header leakage, viewport CSS metadata,
 * or web scraper boilerplate/watermark noise (DTV-EBOOK, fonts.googleapis.com, etc.).
 */
export function isJunkScrapedText(raw: string): boolean {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return true;
  if (text.length < 2) return true;
  if (JUNK_LINE_PATTERNS.some((rx) => rx.test(text))) {
    return true;
  }
  // Detect high density of HTML attributes / CSS declarations / URLs in one block
  const attrMatches = text.match(/\b(href|src|rel|content|charset|http-equiv|media|crossorigin)\s*=/gi);
  if (attrMatches && attrMatches.length >= 2) return true;
  return false;
}

/**
 * Strips stray HTML tags, entities, and inline scraper watermarks while preserving real prose.
 */
export function cleanParagraphText(raw: string): string {
  let out = (raw || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  for (const rx of INLINE_JUNK_SNIPPETS) {
    out = out.replace(rx, ' ');
  }

  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

export interface BookCleanReport {
  cleanedBook: Book;
  totalParagraphsBefore: number;
  totalParagraphsAfter: number;
  removedCount: number;
  cleanedCount: number;
  removedSamples: string[];
}

/**
 * Scans all chapters in a Book, removes HTML header leaks, scraper ads, and watermarks,
 * deduplicates adjacent identical watermark lines, and normalizes clean EPUB chapters.
 */
export function cleanBookChaptersOnDevice(book: Book): BookCleanReport {
  let totalParagraphsBefore = 0;
  let totalParagraphsAfter = 0;
  let removedCount = 0;
  let cleanedCount = 0;
  const removedSamples: string[] = [];

  const recordRemoved = (sample: string) => {
    removedCount += 1;
    const compact = sample.replace(/\s+/g, ' ').trim();
    if (compact && removedSamples.length < 8 && !removedSamples.includes(compact)) {
      removedSamples.push(compact.slice(0, 120));
    }
  };

  const cleanedChapters: Chapter[] = book.chapters.map((ch) => {
    const nextParagraphs: string[] = [];
    let prevNorm = '';

    for (const rawPara of ch.paragraphs || []) {
      totalParagraphsBefore += 1;
      if (isJunkScrapedText(rawPara)) {
        recordRemoved(rawPara);
        continue;
      }
      const cleaned = cleanParagraphText(rawPara);
      if (!cleaned || isJunkScrapedText(cleaned)) {
        recordRemoved(rawPara);
        continue;
      }
      if (cleaned !== rawPara.trim()) {
        cleanedCount += 1;
      }
      const norm = cleaned.toLowerCase();
      if (norm === prevNorm && norm.length < 80) {
        recordRemoved(rawPara);
        continue;
      }
      prevNorm = norm;
      nextParagraphs.push(cleaned);
    }

    const safeParagraphs =
      nextParagraphs.length > 0
        ? nextParagraphs
        : ['(Nội dung chương này đã được lọc sạch rác kỹ thuật.)'];

    totalParagraphsAfter += safeParagraphs.length;

    return {
      ...ch,
      title: cleanParagraphText(ch.title) || ch.title,
      paragraphs: safeParagraphs,
    };
  });

  const clampedChapterIdx = Math.min(
    Math.max(0, book.currentChapterIndex),
    Math.max(0, cleanedChapters.length - 1)
  );
  const maxPara = Math.max(0, (cleanedChapters[clampedChapterIdx]?.paragraphs.length || 1) - 1);
  const clampedParaIdx = Math.min(Math.max(0, book.currentParagraphIndex), maxPara);

  const cleanedBook: Book = {
    ...book,
    title: cleanParagraphText(book.title) || book.title,
    author: cleanParagraphText(book.author) || book.author,
    description: cleanParagraphText(book.description) || book.description,
    chapters: cleanedChapters,
    currentChapterIndex: clampedChapterIdx,
    currentParagraphIndex: clampedParaIdx,
    lastReadAt: Date.now(),
  };

  return {
    cleanedBook,
    totalParagraphsBefore,
    totalParagraphsAfter,
    removedCount,
    cleanedCount,
    removedSamples,
  };
}
