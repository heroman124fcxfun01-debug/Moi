import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFrameDifferenceScore,
  shouldKeepCandidateFrame,
  assembleScannedPagesToBook,
} from './videoBookScanner';

describe('videoBookScanner', () => {
  it('computes 0 difference for identical frames and 1 for black vs white', () => {
    const a = new Uint8Array([100, 100, 100, 100]);
    const b = new Uint8Array([100, 100, 100, 100]);
    assert.equal(computeFrameDifferenceScore(a, b), 0);

    const black = new Uint8Array([0, 0, 0, 0]);
    const white = new Uint8Array([255, 255, 255, 255]);
    assert.equal(computeFrameDifferenceScore(black, white), 1);
  });

  it('rejects duplicate, pitch-black, and overexposed frames', () => {
    assert.equal(shouldKeepCandidateFrame(0.01, 140, 0.055), false);
    assert.equal(shouldKeepCandidateFrame(0.25, 10, 0.055), false);
    assert.equal(shouldKeepCandidateFrame(0.25, 252, 0.055), false);
    assert.equal(shouldKeepCandidateFrame(0.14, 165, 0.055), true);
  });

  it('assembles scanned chapters into a clean EPUB Book with fallback defaults', () => {
    const book = assembleScannedPagesToBook({
      title: '  Đạo Đức Kinh  ',
      author: 'Lão Tử',
      chapters: [
        { title: 'Chương 1', paragraphs: ['  Đạo khả đạo  ', '   ', 'Phi thường đạo.'] },
        { title: 'Chương rỗng', paragraphs: ['   '] },
      ],
      targetLang: 'vi',
    });

    assert.equal(book.title, 'Đạo Đức Kinh');
    assert.equal(book.author, 'Lão Tử');
    assert.equal(book.sourceType, 'epub');
    assert.equal(book.chapters.length, 1);
    assert.equal(book.chapters[0].index, 0);
    assert.deepEqual(book.chapters[0].paragraphs, ['Đạo khả đạo', 'Phi thường đạo.']);
  });
});
