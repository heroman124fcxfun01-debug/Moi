import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeToneColorEqFromEmbedding,
  resolveDefaultCharacterAssignment,
  resolveSpeechEngineRoute,
  sliceRemainingSpeechFromCursor,
} from './ttsRouter';
import type { CharacterVoiceAssignment, ExternalVoiceAsset, SpeakerEmbeddingVector } from '../types/book';

const SAMPLE_EMBEDDING: SpeakerEmbeddingVector = {
  vectorId: 'spk-9f2a1c',
  f0Hz: 118,
  spectralCentroidHz: 940,
  lowBandRatio: 0.62,
  midBandRatio: 0.28,
  highBandRatio: 0.1,
  zcr: 0.04,
  dynamicRangeDb: 18,
  cadenceFactor: 0.96,
  envelope16: [0.85, 0.78, 0.72, 0.64, 0.48, 0.42, 0.35, 0.3, 0.24, 0.2, 0.14, 0.12, 0.1, 0.09, 0.07, 0.06],
  estimatedGender: 'male',
};

const SAMPLE_CLONED_VOICE: ExternalVoiceAsset = {
  id: 'ext-custom-1',
  name: 'Nhân vật A',
  fileName: 'nhan_vat_a.wav',
  mimeType: 'audio/wav',
  dataUrl: 'data:audio/wav;base64,UklGRg==',
  cleanVocalSampleUrl: 'data:audio/wav;base64,UklGRg==',
  speakerEmbedding: SAMPLE_EMBEDDING,
  addedAt: 1700000000000,
};

test('TtsRouter routes CUSTOM_CLONED voices strictly to ON_DEVICE_CLONED and never silently falls back to SYSTEM_TTS', () => {
  const customAssign: CharacterVoiceAssignment = {
    characterId: 'narrator',
    source: 'external',
    geminiVoice: 'Kore',
    externalVoiceId: 'ext-custom-1',
    stylePrompt: 'Trầm ấm, hào hùng',
    browserPitch: 1,
    browserRate: 1,
  };

  const routed = resolveSpeechEngineRoute(customAssign, [SAMPLE_CLONED_VOICE], 'novel');
  assert.equal(routed.engine, 'ON_DEVICE_CLONED');
  assert.equal(routed.missingEmbeddingError, undefined);
  assert.ok(routed.clonedSynthesis);
  assert.equal(routed.clonedSynthesis?.vectorId, 'spk-9f2a1c');
  assert.equal(routed.clonedSynthesis?.gender, 'male');

  // Missing embedding MUST report an explicit error rather than silently routing to SYSTEM_TTS
  const brokenVoice: ExternalVoiceAsset = { ...SAMPLE_CLONED_VOICE, id: 'ext-broken', speakerEmbedding: undefined };
  const brokenRoute = resolveSpeechEngineRoute(
    { ...customAssign, externalVoiceId: 'ext-broken' },
    [brokenVoice],
    'novel'
  );
  assert.equal(brokenRoute.engine, 'ON_DEVICE_CLONED');
  assert.ok(brokenRoute.missingEmbeddingError && brokenRoute.missingEmbeddingError.length > 10);

  // Built-in / OS voice routes to SYSTEM_TTS
  const sysRoute = resolveSpeechEngineRoute(
    { ...customAssign, source: 'gemini', externalVoiceId: undefined, geminiVoice: 'Kore' },
    [SAMPLE_CLONED_VOICE],
    'novel'
  );
  assert.equal(sysRoute.engine, 'SYSTEM_TTS');
});

test('sliceRemainingSpeechFromCursor resumes cleanly from mid-batch cursor D without resetting to A', () => {
  const text = 'Gió đêm thổi qua những triền cát vàng. Lữ Khách dừng bước trên đỉnh đồi đá, siết chặt quai ba lô.';
  // Cursor D is around "dừng bước"
  const targetIdx = text.indexOf('dừng bước');
  const sliced = sliceRemainingSpeechFromCursor(text, targetIdx + 2);
  assert.equal(sliced.remainingText.startsWith('dừng bước'), true);
  assert.equal(sliced.remainingText.includes('Gió đêm'), false);
  assert.equal(sliced.effectiveStartOffset, targetIdx);

  // Cursor at 0 returns full text
  const full = sliceRemainingSpeechFromCursor(text, 0);
  assert.equal(full.remainingText, text);
  assert.equal(full.effectiveStartOffset, 0);
});

test('resolveDefaultCharacterAssignment defaults un-overridden characters to the exact Narrator voice', () => {
  const narrator: CharacterVoiceAssignment = {
    characterId: 'narrator',
    source: 'external',
    geminiVoice: 'Fenrir',
    externalVoiceId: 'ext-custom-1',
    stylePrompt: 'Trầm ấm',
    browserPitch: 0.85,
    browserRate: 0.96,
    isCustomOverride: true,
  };

  const autoChar = resolveDefaultCharacterAssignment('char-1', narrator, {});
  assert.equal(autoChar.source, 'external');
  assert.equal(autoChar.externalVoiceId, 'ext-custom-1');
  assert.equal(autoChar.isCustomOverride, false);

  const manualChar: CharacterVoiceAssignment = {
    characterId: 'char-2',
    source: 'gemini',
    geminiVoice: 'Aoede',
    stylePrompt: 'Sắc sảo',
    browserPitch: 1.15,
    browserRate: 1.05,
    isCustomOverride: true,
  };
  const kept = resolveDefaultCharacterAssignment('char-2', narrator, { 'char-2': manualChar });
  assert.equal(kept.geminiVoice, 'Aoede');
  assert.equal(kept.isCustomOverride, true);
});

test('computeToneColorEqFromEmbedding produces deep bass boost and lower pitch factor for deep male embedding', () => {
  const eq = computeToneColorEqFromEmbedding(SAMPLE_EMBEDDING);
  assert.ok(eq.lowShelfDb > 0, `expected positive bass shelf for deep voice, got ${eq.lowShelfDb}`);
  assert.ok(eq.pitchFactor < 0.85, `expected low pitch factor for 118Hz F0, got ${eq.pitchFactor}`);
});
