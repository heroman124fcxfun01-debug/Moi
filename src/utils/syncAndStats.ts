import type {
  Book,
  BookProgressSnapshot,
  ReadingLogEntry,
  SyncBackupBundle,
} from '../types/book';
import { computeReadingProgress } from './textProcessing';

/**
 * Computes a deterministic content fingerprint so identical book files uploaded
 * on different devices match and restore exact reading progress.
 */
export function computeBookFingerprint(
  book: Pick<Book, 'title' | 'author' | 'chapters'>
): string {
  const normTitle = (book.title || '').trim().toLowerCase();
  const normAuthor = (book.author || '').trim().toLowerCase();
  const firstCh = book.chapters?.[0]?.paragraphs?.slice(0, 2).join(' ').slice(0, 160) || '';
  const signature = `${normTitle}|${normAuthor}|${book.chapters?.length || 0}|${firstCh.toLowerCase()}`;

  let hash = 2166136261;
  for (let i = 0; i < signature.length; i++) {
    hash ^= signature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fp-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createProgressSnapshot(book: Book): BookProgressSnapshot {
  return {
    id: book.id,
    fingerprint: book.fingerprint || computeBookFingerprint(book),
    title: book.title,
    author: book.author,
    collection: book.collection,
    readingStyle: book.readingStyle,
    currentChapterIndex: book.currentChapterIndex,
    currentParagraphIndex: book.currentParagraphIndex,
    currentSentenceIndex: book.currentSentenceIndex,
    progressPercent: book.progressPercent,
    bookmarks: book.bookmarks || [],
    highlights: book.highlights || [],
    lastReadAt: book.lastReadAt,
  };
}

export function buildSyncBackupBundle(
  books: Book[],
  readingLogs: ReadingLogEntry[],
  options?: { includeFullBooks?: boolean; deviceLabel?: string }
): SyncBackupBundle {
  const includeFull = options?.includeFullBooks ?? true;
  return {
    version: 1,
    exportedAt: Date.now(),
    deviceLabel: options?.deviceLabel || 'LaziRead Device',
    progressRecords: books.map(createProgressSnapshot),
    readingLogs,
    fullBooks: includeFull ? books : undefined,
  };
}

export interface SyncMergeResult {
  mergedBooks: Book[];
  mergedLogs: ReadingLogEntry[];
  matchedProgressCount: number;
  importedNewBooksCount: number;
}

/**
 * Merges a SyncBackupBundle into the current device library:
 * - Matches existing books by `id` OR content `fingerprint` (so re-uploading the same EPUB/PDF on a new device syncs progress automatically!)
 * - Adds missing books if `fullBooks` is included in the bundle.
 * - Merges reading logs taking max seconds per date.
 */
export function mergeSyncBundleIntoLibrary(
  existingBooks: Book[],
  bundle: SyncBackupBundle
): SyncMergeResult {
  let matchedProgressCount = 0;
  let importedNewBooksCount = 0;

  const snapById = new Map<string, BookProgressSnapshot>();
  const snapByFp = new Map<string, BookProgressSnapshot>();

  for (const snap of bundle.progressRecords || []) {
    snapById.set(snap.id, snap);
    if (snap.fingerprint) snapByFp.set(snap.fingerprint, snap);
  }

  const updatedBooks = existingBooks.map((book) => {
    const fp = book.fingerprint || computeBookFingerprint(book);
    const snap = snapById.get(book.id) || snapByFp.get(fp);
    if (!snap) return book;

    // Apply incoming progress if newer OR further ahead when timestamps match closely
    const shouldApply =
      snap.lastReadAt >= book.lastReadAt ||
      snap.progressPercent > book.progressPercent;

    if (!shouldApply) return book;

    matchedProgressCount += 1;
    const clampedCh = Math.min(
      Math.max(0, snap.currentChapterIndex),
      Math.max(0, book.chapters.length - 1)
    );
    const maxPara = Math.max(0, (book.chapters[clampedCh]?.paragraphs.length || 1) - 1);
    const clampedPara = Math.min(Math.max(0, snap.currentParagraphIndex), maxPara);

    // Deduplicate bookmarks & highlights
    const bmMap = new Map(book.bookmarks.map((b) => [b.id, b]));
    for (const bm of snap.bookmarks || []) bmMap.set(bm.id, bm);

    const hlMap = new Map(book.highlights.map((h) => [h.id, h]));
    for (const hl of snap.highlights || []) hlMap.set(hl.id, hl);

    return {
      ...book,
      fingerprint: fp,
      collection: snap.collection || book.collection,
      readingStyle: snap.readingStyle || book.readingStyle,
      currentChapterIndex: clampedCh,
      currentParagraphIndex: clampedPara,
      currentSentenceIndex: snap.currentSentenceIndex,
      progressPercent: computeReadingProgress(book.chapters, clampedCh, clampedPara),
      bookmarks: Array.from(bmMap.values()),
      highlights: Array.from(hlMap.values()),
      lastReadAt: Math.max(book.lastReadAt, snap.lastReadAt),
    };
  });

  // Add full books from bundle if not already present by id or fingerprint
  if (Array.isArray(bundle.fullBooks)) {
    const existingIds = new Set(updatedBooks.map((b) => b.id));
    const existingFps = new Set(
      updatedBooks.map((b) => b.fingerprint || computeBookFingerprint(b))
    );

    for (const incoming of bundle.fullBooks) {
      const fp = incoming.fingerprint || computeBookFingerprint(incoming);
      if (!existingIds.has(incoming.id) && !existingFps.has(fp)) {
        updatedBooks.push({ ...incoming, fingerprint: fp });
        existingIds.add(incoming.id);
        existingFps.add(fp);
        importedNewBooksCount += 1;
      }
    }
  }

  return {
    mergedBooks: updatedBooks.sort((a, b) => b.lastReadAt - a.lastReadAt),
    mergedLogs: mergeReadingLogs([], bundle.readingLogs || []),
    matchedProgressCount,
    importedNewBooksCount,
  };
}

export function mergeReadingLogs(
  current: ReadingLogEntry[],
  incoming: ReadingLogEntry[]
): ReadingLogEntry[] {
  const byDate = new Map<string, ReadingLogEntry>();
  for (const entry of current) {
    byDate.set(entry.date, { ...entry, booksReadIds: [...entry.booksReadIds] });
  }
  for (const entry of incoming) {
    const existing = byDate.get(entry.date);
    if (!existing) {
      byDate.set(entry.date, { ...entry, booksReadIds: [...entry.booksReadIds] });
    } else {
      const mergedIds = Array.from(new Set([...existing.booksReadIds, ...entry.booksReadIds]));
      byDate.set(entry.date, {
        date: entry.date,
        seconds: Math.max(existing.seconds, entry.seconds),
        booksReadIds: mergedIds,
      });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function formatIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addReadingSecondsToLogs(
  logs: ReadingLogEntry[],
  dateStr: string,
  secondsToAdd: number,
  bookId: string
): ReadingLogEntry[] {
  const idx = logs.findIndex((l) => l.date === dateStr);
  if (idx === -1) {
    return [
      ...logs,
      { date: dateStr, seconds: secondsToAdd, booksReadIds: [bookId] },
    ];
  }
  return logs.map((entry, i) =>
    i === idx
      ? {
          ...entry,
          seconds: entry.seconds + secondsToAdd,
          booksReadIds: entry.booksReadIds.includes(bookId)
            ? entry.booksReadIds
            : [...entry.booksReadIds, bookId],
        }
      : entry
  );
}

export interface ChartBucket {
  label: string;
  minutes: number;
}

export function getWeeklyReadingChart(
  logs: ReadingLogEntry[],
  referenceDate = new Date()
): { buckets: ChartBucket[]; totalMinutes: number } {
  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const map = new Map(logs.map((l) => [l.date, l.seconds]));
  const buckets: ChartBucket[] = [];
  let totalSeconds = 0;

  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - offset);
    const key = formatIsoDateLocal(d);
    const secs = map.get(key) || 0;
    totalSeconds += secs;
    buckets.push({
      label: offset === 0 ? 'Hôm nay' : dayNames[d.getDay()],
      minutes: Math.round(secs / 60),
    });
  }

  return { buckets, totalMinutes: Math.round(totalSeconds / 60) };
}

export function getMonthlyReadingChart(
  logs: ReadingLogEntry[],
  referenceDate = new Date()
): { buckets: ChartBucket[]; totalMinutes: number } {
  const map = new Map(logs.map((l) => [l.date, l.seconds]));
  // Group last 28 days into 4 weeks (Tuần 1 -> Tuần 4)
  const buckets: ChartBucket[] = [];
  let totalSeconds = 0;

  for (let w = 3; w >= 0; w--) {
    let weekSecs = 0;
    for (let dOffset = 0; dOffset < 7; dOffset++) {
      const d = new Date(referenceDate);
      d.setDate(d.getDate() - (w * 7 + dOffset));
      const key = formatIsoDateLocal(d);
      weekSecs += map.get(key) || 0;
    }
    totalSeconds += weekSecs;
    buckets.push({
      label: w === 0 ? 'Tuần này' : `${w} tuần trước`,
      minutes: Math.round(weekSecs / 60),
    });
  }

  return { buckets, totalMinutes: Math.round(totalSeconds / 60) };
}

export function createSeedReadingLogs(referenceDate = new Date()): ReadingLogEntry[] {
  const sampleMinutes = [22, 35, 18, 42, 28, 50, 31];
  const logs: ReadingLogEntry[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - offset);
    logs.push({
      date: formatIsoDateLocal(d),
      seconds: sampleMinutes[6 - offset] * 60,
      booksReadIds: ['seed-eastern-journey'],
    });
  }
  return logs;
}
