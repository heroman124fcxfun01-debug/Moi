import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseGoogleDriveLink,
  normalizeBookTitleForIndex,
  computeLinkScore,
  shouldLinkStayActive,
  rankActiveLinks,
  hasDuplicateDriveFileId,
  filterCommunityBooks,
  mergeBooksAndLinks,
  type CommunityBookDoc,
  type CommunityBookLinkDoc,
} from './communityDriveStore.ts';

describe('communityDriveStore', () => {
  it('validates Google Drive URLs and extracts drive_file_id', () => {
    const valid1 = parseGoogleDriveLink(
      'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing'
    );
    assert.equal(valid1.valid, true);
    assert.equal(valid1.fileId, '1AbCdEfGhIjKlMnOpQrStUvWxYz');

    const valid2 = parseGoogleDriveLink('https://drive.google.com/open?id=9ZyXwVuTsRqPoNmLkJiHg');
    assert.equal(valid2.valid, true);
    assert.equal(valid2.fileId, '9ZyXwVuTsRqPoNmLkJiHg');

    const invalid = parseGoogleDriveLink('https://example.com/random-file.epub');
    assert.equal(invalid.valid, false);
  });

  it('normalizes Vietnamese titles without diacritics', () => {
    assert.equal(
      normalizeBookTitleForIndex('Phàm Nhân Tu Tiên — Tập 1!'),
      'pham nhan tu tien tap 1'
    );
    assert.equal(normalizeBookTitleForIndex('Đắc Nhân Tâm'), 'dac nhan tam');
  });

  it('scores links accurately and hides links with 3+ consecutive failures', () => {
    assert.equal(computeLinkScore(10, 2, 1), 10 * 2 + 2 * 5 - 1 * 15);
    assert.equal(shouldLinkStayActive(2), true);
    assert.equal(shouldLinkStayActive(3), false);

    const links: CommunityBookLinkDoc[] = [
      {
        id: 'l1',
        book_id: 'b1',
        drive_url: 'https://drive.google.com/file/d/id_1111111111/view',
        drive_file_id: 'id_1111111111',
        format: 'EPUB',
        success_count: 2,
        good_votes: 0,
        fail_count: 3,
        consecutive_fails: 3,
        score: computeLinkScore(2, 0, 3),
        is_active: false,
        created_at: 100,
      },
      {
        id: 'l2',
        book_id: 'b1',
        drive_url: 'https://drive.google.com/file/d/id_2222222222/view',
        drive_file_id: 'id_2222222222',
        format: 'EPUB',
        success_count: 5,
        good_votes: 1,
        fail_count: 0,
        consecutive_fails: 0,
        score: computeLinkScore(5, 1, 0),
        is_active: true,
        created_at: 200,
      },
      {
        id: 'l3',
        book_id: 'b1',
        drive_url: 'https://drive.google.com/file/d/id_3333333333/view',
        drive_file_id: 'id_3333333333',
        format: 'EPUB',
        success_count: 20,
        good_votes: 4,
        fail_count: 0,
        consecutive_fails: 0,
        score: computeLinkScore(20, 4, 0),
        is_active: true,
        created_at: 150,
      },
    ];

    const ranked = rankActiveLinks(links);
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].id, 'l3');
    assert.equal(hasDuplicateDriveFileId(links, 'id_2222222222'), true);
    assert.equal(hasDuplicateDriveFileId(links, 'id_9999999999'), false);

    const books: CommunityBookDoc[] = [
      {
        id: 'b1',
        title: 'Phàm Nhân Tu Tiên',
        title_normalized: 'pham nhan tu tien',
        author: 'Vong Ngữ',
        genre: 'Tiên hiệp',
        format: 'EPUB',
        downloads: 99,
        created_at: 100,
        updated_at: 200,
      },
    ];
    const merged = mergeBooksAndLinks(books, links);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].bestLink?.id, 'l3');

    const found = filterCommunityBooks(merged, 'vong ngu', 'Tiên hiệp');
    assert.equal(found.length, 1);
  });
});
