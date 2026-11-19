import test from 'node:test';
import assert from 'node:assert/strict';
import type { Book, UserCollection } from '../types/book';
import { normalizeSearchText, searchEntireApp } from './globalSearch';
import { BUILTIN_FONTS, EREADER_COMMUNITY_FONTS } from './fileHelpers';

function makeBook(id: string, title: string, author: string): Book {
  return {
    id,
    title,
    author,
    description: 'Mô tả sách mẫu',
    language: 'vi',
    sourceType: 'epub',
    chapters: [{ id: `${id}-c1`, index: 0, title: 'Chương mở đầu', paragraphs: ['Xin chào'] }],
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    progressPercent: 25,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt: 1000,
    lastReadAt: 1000,
  };
}

test('normalizeSearchText strips Vietnamese diacritics and đ accurately', () => {
  assert.equal(normalizeSearchText('Đồng Bộ Cài Đặt Google Drive'), 'dong bo cai dat google drive');
  assert.equal(normalizeSearchText('Bộ Sưu Tập Đọc Sách'), 'bo suu tap doc sach');
});

test('searchEntireApp finds settings, Google Drive sync, imports, and language packs without diacritics', () => {
  const books = [makeBook('b1', 'Hành Trình Phương Đông', 'Hoàng Nguyên Vũ')];
  const cols: UserCollection[] = [
    { id: 'c1', name: 'Truyện Tiên Hiệp', bookIds: ['b1'], createdAt: 1000 },
  ];

  const settingsRes = searchEntireApp('cai dat', books, cols);
  assert.ok(settingsRes.some((r) => r.id === 'feat-settings-basic'));

  const syncRes = searchEntireApp('dong bo drive', books, cols);
  assert.ok(syncRes.some((r) => r.category === 'sync'));

  const importRes = searchEntireApp('tai sach', books, cols);
  assert.ok(importRes.some((r) => r.id === 'feat-import-book'));

  const langRes = searchEntireApp('tieng nhat', books, cols);
  assert.ok(langRes.some((r) => r.id === 'lang-ja'));

  const colRes = searchEntireApp('tien hiep', books, cols);
  assert.ok(colRes.some((r) => r.id === 'col-c1' && r.category === 'collection'));

  const bookRes = searchEntireApp('phuong dong', books, cols);
  assert.ok(bookRes.some((r) => r.id === 'book-b1' && r.category === 'book'));

  const fontRes = searchEntireApp('literata', books, cols);
  assert.ok(fontRes.some((r) => r.id === 'feat-ereader-fonts'));
});

test('EREADER_COMMUNITY_FONTS provides 9 Vietnamese-ready e-reader fonts included in BUILTIN_FONTS', () => {
  assert.equal(EREADER_COMMUNITY_FONTS.length, 9);
  const names = new Set(EREADER_COMMUNITY_FONTS.map((f) => f.name));
  assert.equal(names.size, 9);
  for (const font of EREADER_COMMUNITY_FONTS) {
    assert.ok(
      BUILTIN_FONTS.some((b) => b.value === font.value),
      `Expected ${font.name} to be included in BUILTIN_FONTS`
    );
  }
});
