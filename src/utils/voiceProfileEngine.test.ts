import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompactVoiceProfile,
  parseAiVoiceInstruction,
  generateVoiceProfileId,
} from './voiceProfileEngine.ts';

describe('voiceProfileEngine', () => {
  it('translates Vietnamese AI instructions into distinct acoustic parameters', () => {
    const warmSlow = parseAiVoiceInstruction('Giọng trầm ấm, chậm rãi, nhấn mạnh cuối câu, cổ trang', {
      gender: 'male',
    });
    const sharpFast = parseAiVoiceInstruction('Giọng nữ đanh đá, nhanh nhẹn, cao, vui tươi', {
      gender: 'female',
    });

    assert.ok(warmSlow.pitch < sharpFast.pitch, 'warm male voice must have lower pitch than sharp female voice');
    assert.ok(warmSlow.speed < sharpFast.speed, 'slow instruction must reduce speed compared to fast instruction');
    assert.ok(warmSlow.pauseDurationMs > sharpFast.pauseDurationMs, 'slow classical voice should pause longer');
    assert.ok(warmSlow.warmthDb > sharpFast.warmthDb, 'warm instruction should increase warmthDb');
    assert.ok(warmSlow.geminiStylePrompt.includes('nhấn mạnh cuối câu'));
  });

  it('produces unique voiceId and distinct timbre for different imported voice profiles', () => {
    const idA = generateVoiceProfileId('Lão Kiếm Khách', 'sample-a');
    const idB = generateVoiceProfileId('Thiếu Nữ Ngọt Ngào', 'sample-b');
    assert.notEqual(idA, idB);

    const profA = buildCompactVoiceProfile({
      id: idA,
      name: 'Lão Kiếm Khách',
      gender: 'male',
      ageGroup: 'elder',
      personality: 'bold',
      instruction: 'Trầm khàn, chậm rãi, hào sảng',
      acousticPitchHz: 112,
    });
    const profB = buildCompactVoiceProfile({
      id: idB,
      name: 'Thiếu Nữ Ngọt Ngào',
      gender: 'female',
      ageGroup: 'youth',
      personality: 'warm',
      instruction: 'Ngọt ngào, trong trẻo, dịu dàng',
      acousticPitchHz: 235,
    });

    assert.equal(profA.voiceId, idA);
    assert.equal(profA.promptParams.recommendedBaseVoice, 'Fenrir');
    assert.equal(profB.promptParams.recommendedBaseVoice, 'Kore');
    assert.ok(profA.promptParams.pitch < profB.promptParams.pitch);
  });
});
