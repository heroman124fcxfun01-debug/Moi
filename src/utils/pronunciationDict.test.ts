import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPronunciationDict } from './pronunciationDict.ts';

describe('pronunciationDict', () => {
  it('replaces custom words cleanly respecting Vietnamese diacritics and word boundaries', () => {
    const entries = [
      { id: '1', wrongWord: 'Võ Hồn', correctReading: 'Võ Hồn Điện' },
      { id: '2', wrongWord: 'MC', correctReading: 'em xi' },
      { id: '3', wrongWord: 'Sở Phong', correctReading: 'Sở Phông' },
    ];

    const input = 'Sở Phong thức tỉnh Võ Hồn trước mặt MC của đấu trường.';
    const output = applyPronunciationDict(input, entries);

    assert.equal(output, 'Sở Phông thức tỉnh Võ Hồn Điện trước mặt em xi của đấu trường.');
  });

  it('does not corrupt substrings inside longer words', () => {
    const entries = [{ id: '1', wrongWord: 'An', correctReading: 'Án' }];
    const output = applyPronunciationDict('Anh An đang ăn cơm.', entries);
    assert.equal(output, 'Anh Án đang ăn cơm.');
  });
});
