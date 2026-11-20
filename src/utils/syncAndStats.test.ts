import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBookFingerprint,
  buildSyncBackupBundle,
  mergeSyncBundleIntoLibrary,
  mergeProgressBundlesForCloudPush,
  normalizeBookMatchKey,
  addReadingSecondsToLogs,
  getWeeklyReadingChart,
  getMonthlyReadingChart,
  formatCompactHours,
  computeReadingTimeSummary,
} from './syncAndStats';
import type { Book } from '../types/book';

const makeBook = (id: string, title: string, chIdx = 0, pIdx = 0, lastReadAt = 1000): Book => ({
  id,
  title,
  author: 'Tác giả A',
  description: '',
  language: 'vi',
  sourceType: 'epub',
  chapters: [
    { id: 'c1', index: 0, title: 'Chương 1', paragraphs: ['Đoạn mở đầu rất hay.', 'Đoạn hai.'] },
    { id: 'c2', index: 1, title: 'Chương 2', paragraphs: ['Đoạn ba.', 'Đoạn bốn.'] },
  ],
  currentChapterIndex: chIdx,
  currentParagraphIndex: pIdx,
  progressPercent: 25,
  bookmarks: [],
  highlights: [],
  voiceAssignments: {},
  addedAt: 500,
  lastReadAt,
});

test('computeBookFingerprint produces identical hash regardless of book ID across devices', () => {
  const deviceABook = makeBook('device-a-123', 'Ký Ức Phố Cổ');
  const deviceBBook = makeBook('device-b-999', 'Ký Ức Phố Cổ');
  assert.equal(computeBookFingerprint(deviceABook), computeBookFingerprint(deviceBBook));
});

test('mergeSyncBundleIntoLibrary restores reading progress onto re-uploaded identical book file on another device', () => {
  const sourceBook = makeBook('old-id', 'Sách Đồng Bộ', 1, 1, 9000);
  sourceBook.bookmarks = [
    {
      id: 'bm-1',
      chapterId: 'c2',
      chapterTitle: 'Chương 2',
      paragraphIndex: 1,
      excerpt: 'Đoạn bốn.',
      createdAt: 8500,
    },
  ];
  const bundle = buildSyncBackupBundle([sourceBook], [], { includeFullBooks: false });

  // New device re-uploads exact same EPUB -> gets a new random ID
  const newDeviceBook = makeBook('fresh-id-device-2', 'Sách Đồng Bộ', 0, 0, 1000);
  const result = mergeSyncBundleIntoLibrary([newDeviceBook], bundle);

  assert.equal(result.matchedProgressCount, 1);
  assert.equal(result.mergedBooks[0].currentChapterIndex, 1);
  assert.equal(result.mergedBooks[0].currentParagraphIndex, 1);
  assert.equal(result.mergedBooks[0].progressPercent, 100);
  assert.equal(result.mergedBooks[0].bookmarks.length, 1);
});

test('mergeSyncBundleIntoLibrary matches books by normalized filename/title even when fingerprints differ', () => {
  const device1Book = makeBook('d1-a', 'Đắc Nhân Tâm.epub', 1, 0, 8000);
  const bundle = buildSyncBackupBundle([device1Book], [], { includeFullBooks: false });

  const device2Book: Book = {
    ...makeBook('d2-a', 'Đắc Nhân Tâm', 0, 0, 1000),
    fingerprint: 'fp-different-edit',
  };
  assert.equal(normalizeBookMatchKey('Đắc_Nhân_Tâm.epub'), normalizeBookMatchKey('Đắc Nhân Tâm'));
  const result = mergeSyncBundleIntoLibrary([device2Book], bundle);
  assert.equal(result.matchedProgressCount, 1);
  assert.equal(result.mergedBooks[0].currentChapterIndex, 1);
});

test('mergeProgressBundlesForCloudPush preserves remote records for books not on the current device', () => {
  const bookA = makeBook('a-1', 'Sách A', 1, 1, 9000);
  const bookB = makeBook('b-1', 'Sách B', 1, 0, 7000);
  const remote = buildSyncBackupBundle([bookA, bookB], [], { includeFullBooks: false });

  // Device 2 only has Book A at older position, pushing must not delete Book B
  const device2BookA = makeBook('a-2', 'Sách A', 0, 0, 2000);
  const pushed = mergeProgressBundlesForCloudPush([device2BookA], [], remote);
  assert.equal(pushed.progressRecords.length, 2);
  const remoteB = pushed.progressRecords.find((r) => r.title === 'Sách B');
  assert.ok(remoteB);
  assert.equal(remoteB.currentChapterIndex, 1);
});

test('reading time logs aggregate accurately for weekly and monthly charts', () => {
  const ref = new Date(2026, 10, 18); // 2026-11-18
  let logs = addReadingSecondsToLogs([], '2026-11-18', 1800, 'b1'); // 30 mins today
  logs = addReadingSecondsToLogs(logs, '2026-11-17', 900, 'b1'); // 15 mins yesterday
  logs = addReadingSecondsToLogs(logs, '2026-11-01', 1200, 'b1'); // 20 mins earlier this month

  const weekly = getWeeklyReadingChart(logs, ref);
  assert.equal(weekly.buckets.length, 7);
  assert.equal(weekly.totalMinutes, 45);

  const monthly = getMonthlyReadingChart(logs, ref);
  assert.equal(monthly.buckets.length, 4);
  assert.equal(monthly.totalMinutes, 65);
});

test('formatCompactHours formats 100h, 1kh, 10.5kh (exact 10.500h), and 10mh cleanly', () => {
  assert.equal(formatCompactHours(100 * 3600).compact, '100h');
  assert.equal(formatCompactHours(1000 * 3600).compact, '1kh');
  const tenPointFiveK = formatCompactHours(10500 * 3600);
  assert.equal(tenPointFiveK.compact, '10.5kh');
  assert.match(tenPointFiveK.exact, /10[.,]500h/);
  assert.equal(formatCompactHours(10_000_000 * 3600).compact, '10mh');
});

test('computeReadingTimeSummary computes day, week, this month, previous month, and daily average up to current time of day', () => {
  // Reference: 2026-11-18 at 12:00 noon (0.5 day elapsed today)
  const ref = new Date(2026, 10, 18, 12, 0, 0);
  let logs = addReadingSecondsToLogs([], '2026-11-18', 2 * 3600, 'b1'); // 2h today
  logs = addReadingSecondsToLogs(logs, '2026-11-16', 3 * 3600, 'b1'); // 3h two days ago (in week + this month)
  logs = addReadingSecondsToLogs(logs, '2026-10-20', 10 * 3600, 'b1'); // 10h previous month

  const summary = computeReadingTimeSummary(logs, ref);
  assert.equal(summary.todayLabel, '2h');
  assert.equal(summary.weekLabel, '5h');
  assert.equal(summary.thisMonthLabel, '5h');
  assert.equal(summary.prevMonthLabel, '10h');
  assert.equal(summary.totalCompact, '15h');
  // Elapsed days from Oct 20 00:00 to Nov 18 12:00 = 29.5 days -> 15h / 29.5 = ~0.5h
  assert.equal(summary.dailyAverageLabel, '0.5h');
});
