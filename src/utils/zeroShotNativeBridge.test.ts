import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkVietnameseTextForNeuralTts,
  vietnameseToPhonemes,
} from './zeroShotNativeBridge';

test('chunkVietnameseTextForNeuralTts caps every chunk strictly at <= 28 words and preserves offsets', () => {
  const longPara =
    'Mặt trời vừa nhô lên khỏi đỉnh núi cao phía đông, nhuộm vàng cả thung lũng mờ sương. ' +
    'Từ trong ngôi nhà gỗ nhỏ bên dòng suối, người lữ khách nhẹ nhàng mở cửa sổ lắng nghe tiếng chim hót rộn ràng khắp cánh rừng xanh thẳm buổi sớm mai. ' +
    'Anh hít một hơi thật sâu rồi chuẩn bị hành trang cho chặng đường dài phía trước.';

  const chunks = chunkVietnameseTextForNeuralTts([longPara], 0, 28);
  assert.ok(chunks.length >= 2, 'Long paragraph must be split into multiple short sentences');
  for (const chunk of chunks) {
    assert.ok(
      chunk.wordCount <= 28,
      `Expected chunk wordCount <= 28, got ${chunk.wordCount}: "${chunk.text}"`
    );
    assert.equal(
      longPara.slice(chunk.charOffset, chunk.charOffset + chunk.text.length),
      chunk.text
    );
  }
});

test('vietnameseToPhonemes distinguishes all 6 Vietnamese tones accurately', () => {
  const tones = ['ma', 'mà', 'má', 'mả', 'mã', 'mạ'].map((w) =>
    vietnameseToPhonemes(w).join('')
  );
  const unique = new Set(tones);
  assert.equal(unique.size, 6, `All 6 tones must produce distinct IPA sequences: ${tones.join(', ')}`);

  const phrase = vietnameseToPhonemes('phượng hoàng');
  assert.ok(phrase.includes('f'), 'Expected ph -> f onset');
  assert.ok(phrase.includes('ɯə'), 'Expected ươ diphthong');
  assert.ok(phrase.includes('ŋ'), 'Expected ng coda');
});
