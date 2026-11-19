import test from 'node:test';
import assert from 'node:assert/strict';
import type { Book, SyncBackupBundle, UserCollection } from '../types/book';
import {
  DRIVE_EPUB_MIME,
  buildDriveBookFileName,
  detectDuplicateFiles,
  groupBooksForCollectionUpload,
  mergeDownloadedDriveBooks,
} from './googleDriveSync';
import { computeBookFingerprint } from './syncAndStats';

function makeBook(id: string, title: string, collection?: string): Book {
  const chapters = [
    {
      id: `${id}-ch-1`,
      index: 0,
      title: 'Chương 1',
      paragraphs: [
        `Nội dung độc nhất của cuốn ${title} giúp nhận diện mã sách.`,
        'Đoạn văn thứ hai của chương đầu tiên.',
        'Đoạn văn thứ ba tiếp nối mạch truyện.',
        'Đoạn văn thứ tư với tình tiết cao trào.',
        'Đoạn văn thứ năm kết thúc chương một.',
      ],
    },
  ];
  return {
    id,
    title,
    author: 'Tác giả mẫu',
    description: 'Mô tả',
    language: 'vi',
    sourceType: 'epub',
    collection,
    fingerprint: computeBookFingerprint({ title, author: 'Tác giả mẫu', chapters }),
    chapters,
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent: 10,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt: 1000,
    lastReadAt: 1000,
  };
}

test('buildDriveBookFileName sanitizes unsafe path chars and appends .epub', () => {
  assert.equal(buildDriveBookFileName({ title: 'Hành Trình: Phương Đông / Tập 1?' }), 'Hành Trình Phương Đông Tập 1.epub');
  assert.equal(buildDriveBookFileName({ title: '   ' }), 'Sach-LaziRead.epub');
});

test('groupBooksForCollectionUpload groups strictly by Library UserCollections and ignores book tags', () => {
  const b1 = makeBook('b1', 'Kiếm Hiệp 1', 'Thể loại mẫu');
  const b2 = makeBook('b2', 'Kiếm Hiệp 2', 'Thể loại mẫu');
  const b3 = makeBook('b3', 'Tản Văn Đêm', 'Tản Văn');

  // When Library has no user-created collections, Drive collection list must be empty
  assert.equal(groupBooksForCollectionUpload([b1, b2, b3], []).length, 0);

  const cols: UserCollection[] = [
    { id: 'c1', name: 'Tiên Hiệp', bookIds: ['b1', 'b2'], createdAt: 1000 },
  ];

  const grouped = groupBooksForCollectionUpload([b1, b2, b3], cols);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].name, 'Tiên Hiệp');
  assert.equal(grouped[0].books.length, 2);
});

test('detectDuplicateFiles flags existing Drive files case-insensitively for overwrite warning', () => {
  const b1 = makeBook('b1', 'Hành Trình Phương Đông');
  const b2 = makeBook('b2', 'Ký Ức Phố Cổ');

  const scan = detectDuplicateFiles(
    [
      { book: b1, targetFolderName: 'sáchlazy/sách lẻ', targetFolderId: 'folder-single' },
      { book: b2, targetFolderName: 'sáchlazy/sách lẻ', targetFolderId: 'folder-single' },
    ],
    {
      'folder-single': [
        {
          id: 'drive-file-123',
          name: 'hành trình phương đông.epub',
          mimeType: DRIVE_EPUB_MIME,
          modifiedTime: '2026-11-19T00:00:00Z',
        },
      ],
    }
  );

  assert.equal(scan.duplicates.length, 1);
  assert.equal(scan.duplicates[0].existingFileId, 'drive-file-123');
  assert.equal(scan.freshItems.length, 1);
  assert.equal(scan.freshItems[0].book.id, 'b2');
});

test('mergeDownloadedDriveBooks auto-creates matching collections and restores Drive progress', () => {
  const remoteBook = makeBook('remote-1', 'Bí Mật Tháp Đồng Hồ');
  const fp = remoteBook.fingerprint!;

  const progressBundle: SyncBackupBundle = {
    version: 1,
    exportedAt: 5000,
    deviceLabel: 'Old Phone',
    progressRecords: [
      {
        id: 'old-id',
        fingerprint: fp,
        title: remoteBook.title,
        author: remoteBook.author,
        currentChapterIndex: 0,
        currentParagraphIndex: 3,
        progressPercent: 80,
        bookmarks: [],
        highlights: [],
        lastReadAt: 999999,
      },
    ],
    readingLogs: [{ date: '2026-11-18', seconds: 1200, booksReadIds: ['old-id'] }],
  };

  const res = mergeDownloadedDriveBooks(
    [],
    [],
    [{ book: remoteBook, collectionName: 'Trinh Thám Kinh Điển' }],
    progressBundle,
    []
  );

  assert.equal(res.addedBooksCount, 1);
  assert.equal(res.createdCollectionsCount, 1);
  assert.equal(res.mergedCollections.length, 1);
  assert.equal(res.mergedCollections[0].name, 'Trinh Thám Kinh Điển');
  assert.equal(res.mergedCollections[0].bookIds.length, 1);
  assert.equal(res.mergedBooks[0].progressPercent, 80);
  assert.equal(res.mergedBooks[0].currentParagraphIndex, 3);
  assert.equal(res.mergedLogs.length, 1);
});
