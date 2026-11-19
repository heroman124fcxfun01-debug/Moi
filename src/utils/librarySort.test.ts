import test from 'node:test';
import assert from 'node:assert/strict';
import type { Book, UserCollection } from '../types/book';
import { sortBooksByMode, sortCollectionsByMode } from './librarySort';

function makeBook(
  id: string,
  title: string,
  addedAt: number,
  lastReadAt: number,
  progressPercent = 10
): Book {
  return {
    id,
    title,
    author: 'Tác giả',
    description: '',
    language: 'vi',
    sourceType: 'epub',
    chapters: [{ id: `${id}-1`, index: 0, title: 'C1', paragraphs: ['Test'] }],
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt,
    lastReadAt,
  };
}

test('sortBooksByMode sorts accurately by A-Z, recently added, and recently read', () => {
  const b1 = makeBook('1', 'Đắc Nhân Tâm', 100, 500);
  const b2 = makeBook('2', 'An Nam Chí Lược', 300, 200);
  const b3 = makeBook('3', 'Nhà Giả Kim', 200, 900);

  assert.deepEqual(
    sortBooksByMode([b1, b2, b3], 'title_asc').map((b) => b.id),
    ['2', '1', '3']
  );
  assert.deepEqual(
    sortBooksByMode([b1, b2, b3], 'added_desc').map((b) => b.id),
    ['2', '3', '1']
  );
  assert.deepEqual(
    sortBooksByMode([b1, b2, b3], 'recent').map((b) => b.id),
    ['3', '1', '2']
  );
});

test('sortCollectionsByMode sorts collections by A-Z, recently added, and recently read book', () => {
  const bOld = makeBook('b1', 'Cũ', 100, 100);
  const bHot = makeBook('b2', 'Đang đọc', 150, 9999);
  const c1: UserCollection = { id: 'c1', name: 'Văn học', bookIds: ['b2'], createdAt: 100 };
  const c2: UserCollection = { id: 'c2', name: 'Ẩm thực', bookIds: ['b1'], createdAt: 500 };
  const c3: UserCollection = { id: 'c3', name: 'Kinh tế', bookIds: [], createdAt: 300 };

  assert.deepEqual(
    sortCollectionsByMode([c1, c2, c3], [bOld, bHot], 'name_asc').map((c) => c.id),
    ['c2', 'c3', 'c1']
  );
  assert.deepEqual(
    sortCollectionsByMode([c1, c2, c3], [bOld, bHot], 'recent_added').map((c) => c.id),
    ['c2', 'c3', 'c1']
  );
  assert.deepEqual(
    sortCollectionsByMode([c1, c2, c3], [bOld, bHot], 'recent_read').map((c) => c.id),
    ['c1', 'c2', 'c3']
  );
});
