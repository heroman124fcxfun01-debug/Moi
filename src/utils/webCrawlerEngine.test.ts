import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  buildLibraryCollectionZip,
  computePageSignature,
  detectDuplicateOrLoop,
  detectPaywallOrIssue,
} from './webCrawlerEngine';
import type { Book } from '../types/book';

test('detectPaywallOrIssue catches Vietnamese paywall/VIP blocks and empty pages', () => {
  const vipRes = detectPaywallOrIssue('Chương 6: Đọc tiếp', [
    'Đây là chương VIP. Vui lòng nạp xu hoặc trả phí để đọc tiếp phần còn lại.',
  ]);
  assert.equal(vipRes.hasIssue, true);
  assert.equal(vipRes.reason, 'paywall');

  const emptyRes = detectPaywallOrIssue('Trống', []);
  assert.equal(emptyRes.hasIssue, true);
  assert.equal(emptyRes.reason, 'empty');

  const normalRes = detectPaywallOrIssue('Chương 1', [
    'Gió đêm thổi nhẹ qua hàng cây ven sông mang theo hơi lạnh đầu đông, ánh đèn vàng hắt xuống mặt đường lát đá cổ kính khiến khung cảnh trở nên yên tĩnh lạ thường.',
  ]);
  assert.equal(normalRes.hasIssue, false);
});

test('detectDuplicateOrLoop flags repeated content from page 1 and prevents infinite loops', () => {
  const existing = [
    {
      url: 'http://localhost:3000/demo-web-book/chap-1',
      title: 'Chương 1',
      paragraphs: ['Đoạn mở đầu của câu chuyện rất hấp dẫn và đầy bí ẩn.'],
    },
    {
      url: 'http://localhost:3000/demo-web-book/chap-2',
      title: 'Chương 2',
      paragraphs: ['Tiếp tục cuộc hành trình vào sáng sớm hôm sau.'],
    },
  ];

  // Different URL query param but exact same text as Chapter 1 -> triggers loop detection
  const loopRes = detectDuplicateOrLoop(
    'http://localhost:3000/demo-web-book/chap-1?retry=1',
    'Chương 1',
    ['Đoạn mở đầu của câu chuyện rất hấp dẫn và đầy bí ẩn.'],
    existing
  );
  assert.equal(loopRes.isDuplicate, true);
  assert.equal(loopRes.isLoopToStart, true);

  // Fresh chapter 3 -> allowed
  const okRes = detectDuplicateOrLoop(
    'http://localhost:3000/demo-web-book/chap-3',
    'Chương 3',
    ['Nhân vật chính bước vào thư viện cổ để tìm bản đồ bị thất lạc.'],
    existing
  );
  assert.equal(okRes.isDuplicate, false);
  assert.ok(computePageSignature('A', ['B']).startsWith('pg-'));
});

test('buildLibraryCollectionZip organizes books into collection folders inside one archive', async () => {
  const sampleBook: Book = {
    id: 'b-zip-1',
    title: 'Sách Học Tập',
    author: 'Tác giả',
    description: 'Mô tả',
    language: 'vi',
    sourceType: 'epub',
    collection: 'Học tập',
    readingStyle: 'selfhelp',
    chapters: [{ id: 'c1', index: 0, title: 'Chương 1', paragraphs: ['Nội dung mẫu.'] }],
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent: 10,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt: 1000,
    lastReadAt: 1000,
  };

  const zipBlob = await buildLibraryCollectionZip([sampleBook]);
  const buf = await zipBlob.arrayBuffer();
  const loaded = await JSZip.loadAsync(buf);

  const keys = Object.keys(loaded.files);
  assert.ok(keys.some((k) => k.includes('LaziRead-ThuVien-BoSuuTap/hoc-tap/sach-hoc-tap.epub')));
  assert.ok(keys.some((k) => k.endsWith('muc-luc-thu-vien.json')));
});
