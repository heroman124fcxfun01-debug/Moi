import type { Book } from '../types/book';
import { resolveApiUrl } from './apiClient';
import {
  isSuspiciousForAiProofread,
  mergeAiBookFindings,
  scanBookForCleanup,
  type BookCleanupReport,
  type BookScanFinding,
  type CleanupCategory,
  type PreReadDecision,
} from './aiContentCleaner';

const VALID_CATEGORIES: CleanupCategory[] = [
  'addressesAndHeaders',
  'typosAndCensored',
  'repeatedNotes',
];

/**
 * Job 1 Client Pipeline:
 * 1. Runs instant deterministic full-book scan across all chapters (0ms).
 * 2. Sends suspicious paragraphs (unresolved `*` censoring, OCR typos, ambiguous notes/headers)
 *    to server-side Gemini AI (`/api/ai/proofread-book`) with a fast timeout so import stays snappy.
 * 3. Merges results into one unified 3-category report for the user's confirmation checkboxes.
 */
export async function runImportBookAiScan(
  book: Book,
  onProgress?: (msg: string) => void
): Promise<BookCleanupReport> {
  onProgress?.('AI đang quét địa chỉ thừa, lỗi chữ & chú thích lặp...');
  const localReport = scanBookForCleanup(book);

  // Pick up to 28 suspicious paragraphs across chapters for Gemini AI contextual proofreading
  const candidates: Array<{ chapterIndex: number; paragraphIndex: number; text: string }> = [];
  for (let chIdx = 0; chIdx < book.chapters.length && candidates.length < 28; chIdx++) {
    const paras = book.chapters[chIdx]?.paragraphs || [];
    for (let pIdx = 0; pIdx < paras.length && candidates.length < 28; pIdx++) {
      const txt = (paras[pIdx] || '').trim();
      if (!txt || txt.length > 600) continue;
      if (isSuspiciousForAiProofread(txt)) {
        candidates.push({ chapterIndex: chIdx, paragraphIndex: pIdx, text: txt });
      }
    }
  }

  // If no suspicious candidates or offline, return local scan immediately
  if (
    candidates.length === 0 ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return localReport;
  }

  const controller = new AbortController();
  const timeout = typeof window !== 'undefined' ? window.setTimeout(() => controller.abort(), 5500) : null;

  try {
    onProgress?.('AI đang hiệu đính ngữ cảnh & từ bị lỗi...');
    const resp = await fetch(resolveApiUrl('/api/ai/proofread-book'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        bookTitle: book.title,
        candidates,
      }),
    });
    if (!resp.ok) {
      return localReport;
    }
    const data = (await resp.json()) as {
      findings?: Array<{
        chapterIndex: number;
        paragraphIndex: number;
        category: string;
        action: 'remove' | 'replace';
        cleaned?: string;
        reason?: string;
      }>;
    };

    const rawList = Array.isArray(data.findings) ? data.findings : [];
    const mapped: BookScanFinding[] = [];
    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      const cat = VALID_CATEGORIES.includes(item.category as CleanupCategory)
        ? (item.category as CleanupCategory)
        : 'typosAndCensored';
      const orig =
        book.chapters[item.chapterIndex]?.paragraphs?.[item.paragraphIndex]?.trim() || '';
      if (!orig) continue;
      const cleaned = item.action === 'remove' ? '' : String(item.cleaned || '').trim();
      if (item.action === 'replace' && (!cleaned || cleaned === orig)) continue;
      mapped.push({
        id: `ai-f-${item.chapterIndex}-${item.paragraphIndex}-${i}`,
        category: cat,
        chapterIndex: item.chapterIndex,
        paragraphIndex: item.paragraphIndex,
        action: item.action === 'remove' ? 'remove' : 'replace',
        original: orig,
        cleaned,
        reason: String(item.reason || 'AI hiệu đính nội dung'),
      });
    }

    return mergeAiBookFindings(localReport, mapped);
  } catch {
    // Graceful fallback: keep deterministic local scan findings if offline/timeout
    return localReport;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

/**
 * Job 2 Client Pipeline (Pre-Read Lookahead AI):
 * Runs asynchronously AHEAD of the AI Voice Reader to inspect upcoming paragraphs on existing books.
 * Flags junk/address paragraphs as `skip` and repairs subtle typos/censored words as `fix`.
 */
export async function runPreReadLookaheadAiScan(
  input: {
    bookTitle: string;
    chapterTitle: string;
    items: Array<{ paragraphIndex: number; text: string }>;
  },
  signal?: AbortSignal
): Promise<PreReadDecision[]> {
  if (!input.items.length) return [];
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return [];

  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort, { once: true });
  const timer =
    typeof window !== 'undefined' ? window.setTimeout(() => controller.abort(), 4500) : null;

  try {
    const resp = await fetch(resolveApiUrl('/api/ai/preread-scan'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(input),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      decisions?: Array<{
        paragraphIndex: number;
        action: 'keep' | 'skip' | 'fix';
        cleanedText?: string;
        reason?: string;
      }>;
    };
    if (!Array.isArray(data.decisions)) return [];

    const origByIdx = new Map(input.items.map((it) => [it.paragraphIndex, it.text]));
    const results: PreReadDecision[] = [];
    for (const d of data.decisions) {
      const orig = origByIdx.get(d.paragraphIndex);
      if (orig === undefined) continue;
      const action = d.action === 'skip' || d.action === 'fix' ? d.action : 'keep';
      const cleaned =
        action === 'skip' ? '' : String(d.cleanedText || orig).trim() || orig;
      results.push({
        paragraphIndex: d.paragraphIndex,
        action: action === 'fix' && cleaned === orig.trim() ? 'keep' : action,
        cleanedText: cleaned,
        reason: d.reason ? String(d.reason) : undefined,
        source: 'ai',
      });
    }
    return results;
  } catch {
    return [];
  } finally {
    if (timer !== null) window.clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
