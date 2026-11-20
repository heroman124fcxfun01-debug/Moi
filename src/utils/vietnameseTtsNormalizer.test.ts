import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVietnameseForSpeech } from './vietnameseTtsNormalizer';

describe('vietnameseTtsNormalizer', () => {
  it('strips stray OCR uppercase artifacts like "I I C S" cleanly', () => {
    const input = 'Trời bắt đầu mưa lớn I I C S ngoài sân vắng lặng.';
    const out = normalizeVietnameseForSpeech(input);
    assert.equal(out, 'Trời bắt đầu mưa lớn ngoài sân vắng lặng.');
    assert.ok(!out.includes('I I C S'));
  });

  it('strips glued artifact tokens like IICS, CSS, HTML, footnotes, and dividers', () => {
    const input = 'Đoạn văn này[1] có lỗi IICS *** và mã <em>HTML</em> --- kết thúc.';
    const out = normalizeVietnameseForSpeech(input);
    assert.ok(!out.includes('IICS'));
    assert.ok(!out.includes('[1]'));
    assert.ok(!out.includes('<em>'));
    assert.ok(out.includes('Đoạn văn này'));
    assert.ok(out.includes('kết thúc.'));
  });

  it('converts structural Roman numerals to spoken Arabic numbers', () => {
    assert.equal(
      normalizeVietnameseForSpeech('Chương IV: Hành trình ở Thế kỷ XXI'),
      'Chương 4: Hành trình ở Thế kỷ 21'
    );
    assert.equal(
      normalizeVietnameseForSpeech('Phần II — Hồi IX'),
      'Phần 2 — Hồi 9'
    );
  });

  it('rejoins OCR-spaced Vietnamese words and fixes digit/letter swaps', () => {
    const spaced = normalizeVietnameseForSpeech('c h ư ơ n g 1: 1ời mở đầu kh0ng thể quên.');
    assert.equal(spaced, 'chương 1: lời mở đầu không thể quên.');
  });

  it('expands common Vietnamese abbreviations, titles, and units', () => {
    const out = normalizeVietnameseForSpeech(
      'VD: TP. Hồ Chí Minh đạt 95% mục tiêu, vận tốc 60 km/h, PGS. TS. Minh & cộng sự v.v...'
    );
    assert.ok(out.includes('Ví dụ:'));
    assert.ok(out.includes('Thành phố Hồ Chí Minh'));
    assert.ok(out.includes('95 phần trăm'));
    assert.ok(out.includes('60 ki lô mét trên giờ'));
    assert.ok(out.includes('Phó giáo sư Tiến sĩ Minh và cộng sự vân vân'));
  });

  it('expands common web-novel shorthand like ko and đc', () => {
    const out = normalizeVietnameseForSpeech('Hắn ko thể tin đc ng ấy lại quay về.');
    assert.equal(out, 'Hắn không thể tin được người ấy lại quay về.');
  });

  it('rejoins hyphenated line breaks cleanly', () => {
    const out = normalizeVietnameseForSpeech('Một buổi sáng tuyệt-\nvời trên cao nguyên.');
    assert.equal(out, 'Một buổi sáng tuyệt vời trên cao nguyên.');
  });
});
