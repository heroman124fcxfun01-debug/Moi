import type { Book, Chapter } from '../types/book';
import { resolveApiUrl } from './apiClient';
import { buildEpubBlob } from './epubBuilder';
import {
  getLanguagePackDefinition,
  loadInstalledLanguagePacks,
  tryOnDeviceTranslateParagraphs,
} from './languagePacks';
import { computeBookFingerprint } from './syncAndStats';

export interface ParagraphBatch {
  startIndex: number;
  paragraphs: string[];
}

/**
 * Splits paragraphs into fast, token-efficient batches balanced by both character budget
 * and paragraph count so parallel Gemini Flash Lite requests return in ~1-2 seconds.
 */
export function splitParagraphsIntoFastBatches(
  paragraphs: string[],
  maxCharsPerBatch = 4200,
  maxParasPerBatch = 35
): ParagraphBatch[] {
  if (paragraphs.length === 0) return [];
  const batches: ParagraphBatch[] = [];
  let current: string[] = [];
  let currentChars = 0;
  let startIndex = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i] ?? '';
    const len = p.length + 12;
    if (
      current.length > 0 &&
      (current.length >= maxParasPerBatch || currentChars + len > maxCharsPerBatch)
    ) {
      batches.push({ startIndex, paragraphs: current });
      current = [p];
      currentChars = len;
      startIndex = i;
    } else {
      current.push(p);
      currentChars += len;
    }
  }

  if (current.length > 0) {
    batches.push({ startIndex, paragraphs: current });
  }

  return batches;
}

/**
 * Overwrites a book's chapter paragraphs with translated text (preserving the original text
 * safely inside `chapter.translations.__original__` so users can revert anytime) and
 * updates book language + fingerprint so the overwritten EPUB is clean and self-contained.
 */
export function applyTranslatedBookOverwrite(
  book: Book,
  translatedByChapterId: Record<
    string,
    { title?: string; paragraphs: string[] }
  >,
  targetLang: string,
  translatedBookTitle?: string
): Book {
  const now = Date.now();
  const updatedChapters: Chapter[] = book.chapters.map((ch) => {
    const entry = translatedByChapterId[ch.id];
    if (!entry || entry.paragraphs.length === 0) return ch;

    const existingOriginalBackup = ch.translations?.__original__;
    const originalParagraphs = existingOriginalBackup?.paragraphs?.length
      ? existingOriginalBackup.paragraphs
      : ch.paragraphs;

    const mergedParagraphs = ch.paragraphs.map((orig, idx) => {
      const tr = entry.paragraphs[idx];
      return tr && tr.trim().length > 0 ? tr.trim() : orig;
    });

    return {
      ...ch,
      title: entry.title && entry.title.trim().length > 0 ? entry.title.trim() : ch.title,
      paragraphs: mergedParagraphs,
      analysis: undefined, // Reset old-language voice script so TTS adapts to translated text
      translations: {
        ...(ch.translations || {}),
        __original__: existingOriginalBackup || {
          targetLang: '__original__',
          paragraphs: originalParagraphs,
          translatedAt: now,
        },
        [targetLang]: {
          targetLang,
          paragraphs: mergedParagraphs,
          translatedAt: now,
        },
      },
    };
  });

  const nextBook: Book = {
    ...book,
    title:
      translatedBookTitle && translatedBookTitle.trim().length > 0
        ? translatedBookTitle.trim()
        : book.title,
    language: targetLang,
    chapters: updatedChapters,
    lastReadAt: now,
  };

  return {
    ...nextBook,
    fingerprint: computeBookFingerprint(nextBook),
  };
}

/**
 * Restores a previously overwritten book back to its backed-up original paragraphs if available.
 */
export function restoreOriginalBookFromBackup(book: Book): Book | null {
  const hasBackup = book.chapters.some(
    (ch) => (ch.translations?.__original__?.paragraphs?.length || 0) > 0
  );
  if (!hasBackup) return null;

  const restoredChapters = book.chapters.map((ch) => {
    const backup = ch.translations?.__original__;
    if (!backup || backup.paragraphs.length === 0) return ch;
    return {
      ...ch,
      paragraphs: backup.paragraphs,
      analysis: undefined,
    };
  });

  const restored: Book = {
    ...book,
    chapters: restoredChapters,
    lastReadAt: Date.now(),
  };
  return {
    ...restored,
    fingerprint: computeBookFingerprint(restored),
  };
}

export function hasOriginalBookBackup(book: Book): boolean {
  return book.chapters.some(
    (ch) => (ch.translations?.__original__?.paragraphs?.length || 0) > 0
  );
}

/**
 * Fast chapter translation using:
 * 1) Installed browser on-device model (if available) -> instant offline
 * 2) Parallel Gemini Flash Lite endpoint enriched with installed Language Pack glossary
 */
export async function translateParagraphsFast(opts: {
  paragraphs: string[];
  targetLang: string;
  contextTitle?: string;
  preferOnDevice?: boolean;
  signal?: AbortSignal;
}): Promise<{ translations: string[]; engine: 'on-device' | 'gemini-fast' }> {
  const { paragraphs, targetLang, contextTitle = '', preferOnDevice = true, signal } = opts;
  if (paragraphs.length === 0) {
    return { translations: [], engine: 'on-device' };
  }

  const installedPacks = loadInstalledLanguagePacks();
  const pack = installedPacks[targetLang];
  const def = getLanguagePackDefinition(targetLang);

  if (preferOnDevice && pack?.hasBrowserOnDeviceModel) {
    const localResult = await tryOnDeviceTranslateParagraphs(paragraphs, targetLang);
    if (localResult && localResult.length === paragraphs.length) {
      return { translations: localResult, engine: 'on-device' };
    }
  }

  const resp = await fetch(resolveApiUrl('/api/ai/translate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      paragraphs,
      targetLang,
      contextTitle,
      styleDirective: pack?.styleDirective || def.styleDirective,
      glossaryHints: pack?.glossary || def.glossary,
    }),
  });

  const data = (await resp.json().catch(() => ({}))) as {
    translations?: string[];
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Không thể dịch văn bản lúc này.');
  }
  const list = Array.isArray(data.translations) ? data.translations : [];
  return {
    translations: paragraphs.map((orig, idx) => (list[idx] || orig).trim()),
    engine: 'gemini-fast',
  };
}

/**
 * Translates ALL chapters of a book concurrently (3 chapters at a time),
 * overwrites the book's paragraphs permanently, and compiles a clean overwritten .EPUB blob.
 */
export async function translateEntireBookAndBuildEpub(opts: {
  book: Book;
  targetLang: string;
  signal?: AbortSignal;
  onProgress?: (info: {
    completedChapters: number;
    totalChapters: number;
    percent: number;
    message: string;
  }) => void;
}): Promise<{
  overwrittenBook: Book;
  epubBlob: Blob;
  translatedChapterCount: number;
}> {
  const { book, targetLang, signal, onProgress } = opts;
  const totalChapters = book.chapters.length;
  const translatedByChapterId: Record<string, { title?: string; paragraphs: string[] }> = {};
  let completedChapters = 0;

  onProgress?.({
    completedChapters: 0,
    totalChapters,
    percent: 2,
    message: `Bắt đầu AI dịch nhanh ${totalChapters} chương sang ${targetLang.toUpperCase()}...`,
  });

  // Translate up to 3 chapters in parallel for high speed
  const concurrency = 3;
  let nextIdx = 0;

  const worker = async () => {
    while (nextIdx < totalChapters) {
      if (signal?.aborted) {
        throw new Error('Đã hủy quá trình dịch sách.');
      }
      const idx = nextIdx++;
      const ch = book.chapters[idx];
      if (!ch) continue;

      // Reuse already cached translation for this targetLang if present and matching paragraph count
      const cached = ch.translations?.[targetLang];
      if (cached && cached.paragraphs.length === ch.paragraphs.length) {
        translatedByChapterId[ch.id] = { paragraphs: cached.paragraphs };
      } else {
        // Prepend chapter title as item 0 so title is translated in the same single fast round-trip
        const payload = [ch.title, ...ch.paragraphs];
        const res = await translateParagraphsFast({
          paragraphs: payload,
          targetLang,
          contextTitle: `${book.title} - ${ch.title}`,
          signal,
        });
        const [translatedTitle, ...translatedParas] = res.translations;
        translatedByChapterId[ch.id] = {
          title: translatedTitle || ch.title,
          paragraphs: translatedParas,
        };
      }

      completedChapters += 1;
      const pct = Math.min(92, Math.round((completedChapters / Math.max(1, totalChapters)) * 90));
      onProgress?.({
        completedChapters,
        totalChapters,
        percent: pct,
        message: `Đã dịch xong chương ${completedChapters}/${totalChapters}: ${ch.title}`,
      });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, totalChapters)) }, () => worker())
  );

  onProgress?.({
    completedChapters: totalChapters,
    totalChapters,
    percent: 96,
    message: 'Đang ghi đè nội dung & đóng gói file .EPUB mới...',
  });

  const overwrittenBook = applyTranslatedBookOverwrite(
    book,
    translatedByChapterId,
    targetLang
  );

  const epubBlob = await buildEpubBlob(overwrittenBook, {
    translationMode: 'original',
    targetLang,
  });

  onProgress?.({
    completedChapters: totalChapters,
    totalChapters,
    percent: 100,
    message: `Hoàn tất! Đã AI dịch & ghi đè ${totalChapters} chương vào sách và xuất file .EPUB.`,
  });

  return {
    overwrittenBook,
    epubBlob,
    translatedChapterCount: totalChapters,
  };
}
