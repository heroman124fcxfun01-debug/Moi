import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitNarrationDialogueAndThought,
  applySmartBreathingPauses,
} from './aiScriptDirector.ts';

describe('aiScriptDirector', () => {
  it('strictly separates narration lead from inner thought without voice bleeding', () => {
    const chunks = splitNarrationDialogueAndThought(
      'Sở Phong thầm nghĩ: Ta nhất định phải mạnh hơn!'
    );

    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].segmentType, 'narration');
    assert.equal(chunks[0].speakerHint, 'Narrator');
    assert.equal(chunks[0].text, 'Sở Phong thầm nghĩ:');

    assert.equal(chunks[1].segmentType, 'inner_thought');
    assert.equal(chunks[1].speakerHint, 'Sở Phong');
    assert.equal(chunks[1].spatialEffect, 'inner_thought');
    assert.equal(chunks[1].text, 'Ta nhất định phải mạnh hơn!');
  });

  it('splits mixed quoted dialogue cleanly from surrounding narration', () => {
    const chunks = splitNarrationDialogueAndThought(
      'Lâm Động khẽ nói: "Đừng lên tiếng" rồi lùi vào bóng tối.'
    );

    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].segmentType, 'narration');
    assert.equal(chunks[1].segmentType, 'dialogue');
    assert.equal(chunks[1].speakerHint, 'Lâm Động');
    assert.equal(chunks[1].spatialEffect, 'whisper');
    assert.equal(chunks[2].segmentType, 'narration');
  });

  it('inserts gentle breathing pauses into long comma-less Vietnamese sentences', () => {
    const longSentence =
      'Hắn bước đi trong màn sương dày đặc của khu rừng cổ thụ nhưng mà phía trước vẫn không thấy bất kỳ ánh sáng nào xuất hiện cả.';
    const result = applySmartBreathingPauses(longSentence);
    assert.ok(result.includes(', nhưng mà '), `Expected breathing comma before conjunction, got: ${result}`);
  });
});
