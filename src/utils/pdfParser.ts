import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Book, Chapter } from '../types/book';
import { splitPagesIntoChapters } from './textProcessing';
import { computeBookFingerprint } from './syncAndStats';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfExtractionResult {
  bookDraft: Omit<Book, 'id' | 'addedAt' | 'lastReadAt'>;
  pageCount: number;
  hasText: boolean;
}

/**
 * Extracts text from a PDF file page-by-page and structures it into a Book
 * ready both for reading immediately in LaziRead and exporting as `.epub`.
 */
export async function parsePdfBufferToBook(
  buffer: ArrayBuffer,
  fileName: string,
  onProgress?: (currentPage: number, totalPages: number) => void
): Promise<PdfExtractionResult> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;

  let title = fileName.replace(/\.pdf$/i, '');
  let author = 'Tài liệu PDF';

  try {
    const meta = await pdf.getMetadata();
    const info = meta?.info as Record<string, unknown> | undefined;
    if (info?.Title && typeof info.Title === 'string' && info.Title.trim()) {
      title = info.Title.trim();
    }
    if (info?.Author && typeof info.Author === 'string' && info.Author.trim()) {
      author = info.Author.trim();
    }
  } catch {
    // Ignore metadata read errors
  }

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    onProgress?.(pageNum, pageCount);
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    let lastY: number | null = null;
    const lines: string[] = [];
    let currentLine = '';

    for (const item of textContent.items) {
      if (!('str' in item)) continue;
      const str = item.str;
      const y = Array.isArray(item.transform) ? item.transform[5] : null;

      if (lastY !== null && y !== null && Math.abs(y - lastY) > 6) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = str;
      } else {
        currentLine += (currentLine && !currentLine.endsWith(' ') && !str.startsWith(' ') ? ' ' : '') + str;
      }
      if (y !== null) lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    pageTexts.push(lines.join('\n'));
  }

  const totalChars = pageTexts.reduce((acc, t) => acc + t.trim().length, 0);
  const hasText = totalChars > 20;

  const rawChapters = splitPagesIntoChapters(pageTexts, 'Chương', 6);
  const chapters: Chapter[] = rawChapters.map((ch, idx) => ({
    id: `pdf-ch-${idx + 1}`,
    index: idx,
    title: ch.title,
    paragraphs: ch.paragraphs,
  }));

  const fingerprint = computeBookFingerprint({ title, author, chapters });

  return {
    pageCount,
    hasText,
    bookDraft: {
      title,
      author,
      description: `Chuyển đổi tự động từ tệp PDF (${pageCount} trang) sang cấu trúc sách EPUB.`,
      language: 'vi',
      sourceType: 'pdf',
      collection: 'Tài liệu PDF',
      readingStyle: 'research',
      fingerprint,
      chapters,
      currentChapterIndex: 0,
      currentParagraphIndex: 0,
      progressPercent: 1,
      bookmarks: [],
      highlights: [],
      voiceAssignments: {},
    },
  };
}
