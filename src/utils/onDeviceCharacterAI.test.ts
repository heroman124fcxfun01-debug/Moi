import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_VOICE_POOL,
  analyzeChapterOnDevice,
  buildAutoVoiceAssignments,
  detectEmotionFromLine,
} from './onDeviceCharacterAI.ts';

test('CHARACTER_VOICE_POOL provides 5 distinct AI character voices separate from Kore', () => {
  assert.equal(CHARACTER_VOICE_POOL.length, 5);
  const names = new Set(CHARACTER_VOICE_POOL.map((v) => v.voiceName));
  assert.equal(names.size, 5);
  assert.equal(names.has('Kore'), false);
});

test('analyzeChapterOnDevice discovers Vietnamese characters, splits dialogue, and assigns distinct voices offline', () => {
  const paragraphs = [
    'Gió đêm từ phía đông thổi qua những triền cát vàng óng ánh dưới ánh trăng khuyết.',
    '"Con tìm gì ở nơi tận cùng của gió?" — Nhà Giả Kim trầm giọng hỏi.',
    'Lữ Khách quay lại, ánh mắt đầy khao khát đáp: "Tôi đi tìm cuốn sách ghi chép thứ ngôn ngữ mà không cần chữ viết!"',
    'Cô Gái trẻ bước ra từ lều vải, khẽ thì thầm: "Đừng tiến thêm bước nữa, sa mạc đang nổi bão!"',
  ];

  const analysis = analyzeChapterOnDevice('Chương 1: Đêm Trăng', paragraphs, 'novel');

  assert.ok(analysis.characters.length >= 3, 'Should detect narrator plus multiple named characters');
  assert.equal(analysis.characters[0].id, 'narrator');
  assert.equal(analysis.characters[0].suggestedVoiceName, 'Kore');

  const names = analysis.characters.map((c) => c.name);
  assert.ok(names.some((n) => n.includes('Nhà Giả Kim')));
  assert.ok(names.some((n) => n.includes('Lữ Khách')));
  assert.ok(names.some((n) => n.includes('Cô Gái')));

  const femaleChar = analysis.characters.find((c) => c.name.includes('Cô Gái'));
  assert.equal(femaleChar?.gender, 'female');
  assert.ok(
    femaleChar?.suggestedVoiceName === 'Zephyr' || femaleChar?.suggestedVoiceName === 'Aoede'
  );

  // Script should separate narration and dialogue segments preserving paragraphIndex
  assert.ok(analysis.script.length > paragraphs.length);
  assert.ok(analysis.script.some((s) => s.speakerId !== 'narrator'));
});

test('buildAutoVoiceAssignments assigns distinct voices without overriding existing user choices', () => {
  const analysis = analyzeChapterOnDevice(
    'Test',
    ['"Xin chào!" — Cô Gái cười nói.', '"Chào cô." — Lão Hạc đáp.'],
    'novel'
  );
  const existing = {
    narrator: {
      characterId: 'narrator',
      source: 'external' as const,
      geminiVoice: 'Kore' as const,
      stylePrompt: 'Custom user voice',
      browserPitch: 1,
      browserRate: 1,
      externalVoiceId: 'my-voice-1',
    },
  };

  const merged = buildAutoVoiceAssignments(analysis.characters, existing);
  assert.equal(merged.narrator.source, 'external');
  assert.equal(merged.narrator.externalVoiceId, 'my-voice-1');

  const otherIds = Object.keys(merged).filter((k) => k !== 'narrator');
  assert.ok(otherIds.length >= 1);
  for (const id of otherIds) {
    assert.equal(merged[id].source, 'gemini');
    assert.notEqual(merged[id].geminiVoice, 'Kore');
  }
});

test('detectEmotionFromLine detects Vietnamese emotional tones accurately', () => {
  assert.match(detectEmotionFromLine('Cút ngay!', 'hắn quát lớn'), /Mạnh mẽ|giận dữ/);
  assert.match(detectEmotionFromLine('Đi chậm thôi...', 'cô thì thầm'), /Thì thầm/);
  assert.match(detectEmotionFromLine('Con tìm gì thế?', ''), /Tò mò|nghi vấn/);
});
