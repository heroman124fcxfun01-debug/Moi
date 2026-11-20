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
 * Normalizes a book title or filename (stripping .epub/.pdf/.txt extensions and excess spacing)
 * so books uploaded separately on two devices with the same filename/title always match for auto-sync.
 */
export function normalizeBookMatchKey(titleOrFileName: string): string {
  return (titleOrFileName || '')
    .normalize('NFC')
    .replace(/\.(epub|pdf|txt|mobi|azw3)$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Merges local progress with an existing remote SyncBackupBundle before pushing to cloud,
 * preserving progress records for books that exist on other devices but are not present locally.
 */
export function mergeProgressBundlesForCloudPush(
  localBooks: Book[],
  localLogs: ReadingLogEntry[],
  remoteBundle: SyncBackupBundle | null,
  deviceLabel = 'LaziRead Google Drive'
): SyncBackupBundle {
  const localRecords = localBooks.map(createProgressSnapshot);
  if (!remoteBundle) {
    return {
      version: 1,
      exportedAt: Date.now(),
      deviceLabel,
      progressRecords: localRecords,
      readingLogs: localLogs,
    };
  }

  const recordMap = new Map<string, BookProgressSnapshot>();
  const keyFor = (snap: BookProgressSnapshot) =>
    snap.fingerprint || normalizeBookMatchKey(snap.title) || snap.id;

  for (const remote of remoteBundle.progressRecords || []) {
    recordMap.set(keyFor(remote), remote);
  }
  for (const local of localRecords) {
    const k = keyFor(local);
    const existing = recordMap.get(k);
    if (
      !existing ||
      local.lastReadAt >= existing.lastReadAt ||
      local.progressPercent > existing.progressPercent
    ) {
      recordMap.set(k, local);
    }
  }

  return {
    version: 1,
    exportedAt: Date.now(),
    deviceLabel,
    progressRecords: Array.from(recordMap.values()),
    readingLogs: mergeReadingLogs(remoteBundle.readingLogs || [], localLogs),
  };
}

/**
 * Merges a SyncBackupBundle into the current device library:
 * - Matches existing books by `id`, content `fingerprint`, OR normalized filename/title
 *   (so Device 2 downloading/importing Book A gets Device 1's exact reading progress!)
 * - Adds missing books ONLY if `fullBooks` is explicitly included in the bundle.
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
  const snapByTitleKey = new Map<string, BookProgressSnapshot>();

  for (const snap of bundle.progressRecords || []) {
    snapById.set(snap.id, snap);
    if (snap.fingerprint) snapByFp.set(snap.fingerprint, snap);
    const titleKey = normalizeBookMatchKey(snap.title);
    if (titleKey) {
      const prev = snapByTitleKey.get(titleKey);
      if (!prev || snap.lastReadAt >= prev.lastReadAt) {
        snapByTitleKey.set(titleKey, snap);
      }
    }
  }

  const updatedBooks = existingBooks.map((book) => {
    const fp = book.fingerprint || computeBookFingerprint(book);
    const titleKey = normalizeBookMatchKey(book.title);
    const snap =
      snapById.get(book.id) ||
      snapByFp.get(fp) ||
      (titleKey ? snapByTitleKey.get(titleKey) : undefined);
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

  // Add full books from bundle if not already present by id, fingerprint, or normalized title
  if (Array.isArray(bundle.fullBooks)) {
    const existingIds = new Set(updatedBooks.map((b) => b.id));
    const existingFps = new Set(
      updatedBooks.map((b) => b.fingerprint || computeBookFingerprint(b))
    );
    const existingTitleKeys = new Set(
      updatedBooks.map((b) => normalizeBookMatchKey(b.title)).filter(Boolean)
    );

    for (const incoming of bundle.fullBooks) {
      const fp = incoming.fingerprint || computeBookFingerprint(incoming);
      const tKey = normalizeBookMatchKey(incoming.title);
      if (
        !existingIds.has(incoming.id) &&
        !existingFps.has(fp) &&
        (!tKey || !existingTitleKeys.has(tKey))
      ) {
        updatedBooks.push({ ...incoming, fingerprint: fp });
        existingIds.add(incoming.id);
        existingFps.add(fp);
        if (tKey) existingTitleKeys.add(tKey);
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

export interface CompactHoursDisplay {
  compact: string;
  exact: string;
  totalHours: number;
}

/**
 * Formats total reading seconds into compact hours per BOOKHAD spec:
 * - < 1,000h: e.g. 0.5h, 12.4h, 100h
 * - >= 1,000h & < 1,000,000h: e.g. 1kh, 10kh, 10.5kh
 * - >= 1,000,000h: e.g. 1mh, 10mh
 * Plus exact detail string shown when the user taps the total hours value (e.g. "10.500h (10.500 giờ 0 phút)").
 */
export function formatCompactHours(totalSeconds: number): CompactHoursDisplay {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const totalHoursRaw = safeSeconds / 3600;
  const wholeHours = Math.floor(safeSeconds / 3600);
  const remMinutes = Math.floor((safeSeconds % 3600) / 60);

  const trimDecimal = (n: number, digits = 1): string => {
    const fixed = n.toFixed(digits);
    return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
  };

  let compact: string;
  if (totalHoursRaw >= 1_000_000) {
    compact = `${trimDecimal(totalHoursRaw / 1_000_000, 1)}mh`;
  } else if (totalHoursRaw >= 1_000) {
    compact = `${trimDecimal(totalHoursRaw / 1_000, 1)}kh`;
  } else if (totalHoursRaw >= 100) {
    compact = `${Math.round(totalHoursRaw)}h`;
  } else if (totalHoursRaw >= 1) {
    compact = `${trimDecimal(totalHoursRaw, 1)}h`;
  } else if (safeSeconds === 0) {
    compact = '0h';
  } else {
    compact = `${trimDecimal(totalHoursRaw, 1)}h`;
  }

  const formattedWhole = wholeHours.toLocaleString('vi-VN');
  const exact =
    remMinutes > 0
      ? `${formattedWhole}h ${remMinutes}p`
      : `${formattedWhole}h`;

  return {
    compact,
    exact,
    totalHours: totalHoursRaw,
  };
}

export function formatShortHours(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = safe / 3600;
  if (hours === 0) return '0h';
  if (hours >= 1000) return formatCompactHours(safe).compact;
  if (hours >= 10) return `${Math.round(hours)}h`;
  const rounded = Math.round(hours * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}h`;
}

export interface ReadingTimeSummary {
  totalSeconds: number;
  totalCompact: string;
  totalExact: string;
  todaySeconds: number;
  weekSeconds: number;
  thisMonthSeconds: number;
  prevMonthSeconds: number;
  todayLabel: string;
  weekLabel: string;
  thisMonthLabel: string;
  prevMonthLabel: string;
  dailyAverageSeconds: number;
  dailyAverageLabel: string;
}

/**
 * Computes the 3-line Library Reading Time summary:
 * - Line 1: Total reading time (compact + exact detail on tap)
 * - Line 2: Day / Week (last 7 days) / This Month / Previous Calendar Month
 * - Line 3: Daily average calculated accurately up to the current time of day
 */
export function computeReadingTimeSummary(
  logs: ReadingLogEntry[],
  referenceDate = new Date()
): ReadingTimeSummary {
  const todayKey = formatIsoDateLocal(referenceDate);
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth(); // 0..11

  const prevMonthDate = new Date(refYear, refMonth - 1, 1);
  const prevYear = prevMonthDate.getFullYear();
  const prevMonth = prevMonthDate.getMonth();

  const weekKeys = new Set<string>();
  for (let offset = 0; offset < 7; offset++) {
    const d = new Date(referenceDate);
    d.setDate(d.getDate() - offset);
    weekKeys.add(formatIsoDateLocal(d));
  }

  let totalSeconds = 0;
  let todaySeconds = 0;
  let weekSeconds = 0;
  let thisMonthSeconds = 0;
  let prevMonthSeconds = 0;
  let earliestDate: Date | null = null;

  for (const entry of logs) {
    const secs = Math.max(0, Number(entry.seconds) || 0);
    totalSeconds += secs;

    if (entry.date === todayKey) {
      todaySeconds += secs;
    }
    if (weekKeys.has(entry.date)) {
      weekSeconds += secs;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry.date);
    if (match) {
      const y = Number(match[1]);
      const m = Number(match[2]) - 1;
      const d = Number(match[3]);
      if (y === refYear && m === refMonth) {
        thisMonthSeconds += secs;
      } else if (y === prevYear && m === prevMonth) {
        prevMonthSeconds += secs;
      }
      if (secs > 0) {
        const entryDate = new Date(y, m, d, 0, 0, 0, 0);
        if (!earliestDate || entryDate.getTime() < earliestDate.getTime()) {
          earliestDate = entryDate;
        }
      }
    }
  }

  // Daily average up to the exact current time of day:
  // Number of elapsed days = whole days since earliest log + fraction of today elapsed so far.
  const todayStart = new Date(refYear, refMonth, referenceDate.getDate(), 0, 0, 0, 0);
  const fractionOfTodayElapsed = Math.max(
    1 / 24, // prevent extreme spikes right at 00:01
    Math.min(1, (referenceDate.getTime() - todayStart.getTime()) / 86_400_000)
  );

  let elapsedDays = fractionOfTodayElapsed;
  if (earliestDate && earliestDate.getTime() < todayStart.getTime()) {
    const wholePastDays = Math.round(
      (todayStart.getTime() - earliestDate.getTime()) / 86_400_000
    );
    elapsedDays = wholePastDays + fractionOfTodayElapsed;
  }

  const dailyAverageSeconds = totalSeconds > 0 ? totalSeconds / elapsedDays : 0;
  const totalDisplay = formatCompactHours(totalSeconds);

  return {
    totalSeconds,
    totalCompact: totalDisplay.compact,
    totalExact: totalDisplay.exact,
    todaySeconds,
    weekSeconds,
    thisMonthSeconds,
    prevMonthSeconds,
    todayLabel: formatShortHours(todaySeconds),
    weekLabel: formatShortHours(weekSeconds),
    thisMonthLabel: formatShortHours(thisMonthSeconds),
    prevMonthLabel: formatShortHours(prevMonthSeconds),
    dailyAverageSeconds,
    dailyAverageLabel: formatShortHours(dailyAverageSeconds),
  };
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
