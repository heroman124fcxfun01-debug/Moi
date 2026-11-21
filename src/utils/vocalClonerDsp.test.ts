import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSpeakerEmbeddingFromPcm,
  isolateAndDenoiseVocalPcm,
  resolveClonedVoiceSynthesis,
} from './vocalClonerDsp';
import { DEFAULT_VOICE_TONE } from './audioFilterEngine';

function synthTone(freqHz: number, sampleRate: number, durationSec: number): Float32Array {
  const len = Math.floor(sampleRate * durationSec);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    // Fundamental + vocal harmonics with speech-like amplitude modulation
    const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.5 * t);
    out[i] =
      env *
      (0.55 * Math.sin(2 * Math.PI * freqHz * t) +
        0.25 * Math.sin(2 * Math.PI * freqHz * 2 * t) +
        0.12 * Math.sin(2 * Math.PI * freqHz * 3 * t));
  }
  return out;
}

test('isolateAndDenoiseVocalPcm suppresses panned stereo noise while preserving center vocals', () => {
  const sr = 16000;
  const vocal = synthTone(140, sr, 1.2);
  const left = new Float32Array(vocal.length);
  const right = new Float32Array(vocal.length);
  for (let i = 0; i < vocal.length; i++) {
    // Hard-panned out-of-phase accompaniment should cancel out cleanly in center channel
    const bg = 0.35 * Math.sin(2 * Math.PI * 620 * (i / sr));
    left[i] = vocal[i] + bg;
    right[i] = vocal[i] - bg;
  }

  const cleaned = isolateAndDenoiseVocalPcm([left, right], sr);
  assert.equal(cleaned.length, vocal.length);
  const emb = extractSpeakerEmbeddingFromPcm(cleaned, sr, 'male-clean');
  assert.ok(emb.f0Hz >= 120 && emb.f0Hz <= 160, `Expected F0 near 140Hz, got ${emb.f0Hz}`);
  assert.equal(emb.estimatedGender, 'male');
});

test('extractSpeakerEmbeddingFromPcm distinguishes deep male voice vs bright female voice', () => {
  const sr = 16000;
  const malePcm = isolateAndDenoiseVocalPcm([synthTone(110, sr, 1.5)], sr);
  const femalePcm = isolateAndDenoiseVocalPcm([synthTone(245, sr, 1.5)], sr);

  const maleEmb = extractSpeakerEmbeddingFromPcm(malePcm, sr, 'deep-male');
  const femaleEmb = extractSpeakerEmbeddingFromPcm(femalePcm, sr, 'bright-female');

  assert.equal(maleEmb.estimatedGender, 'male');
  assert.equal(femaleEmb.estimatedGender, 'female');
  assert.ok(femaleEmb.f0Hz > maleEmb.f0Hz + 80);
  assert.notEqual(maleEmb.vectorId, femaleEmb.vectorId);
});

test('resolveClonedVoiceSynthesis never falls back to default voice and reacts immediately to slider changes', () => {
  const sr = 16000;
  const maleEmb = extractSpeakerEmbeddingFromPcm(
    isolateAndDenoiseVocalPcm([synthTone(108, sr, 1.5)], sr),
    sr,
    'narrator-deep'
  );

  const baseSynth = resolveClonedVoiceSynthesis({
    name: 'Giọng Trầm',
    embedding: maleEmb,
    tone: { ...DEFAULT_VOICE_TONE, warmthDb: 2, clarityDb: 1, pitch: 1.0, rate: 1.0 },
    ageGroup: 'middle',
    personality: 'cold',
    instruction: 'Đọc trầm chậm, uy lực',
  });

  // Must NOT revert to default Kore with 1.0 pitch!
  assert.notEqual(baseSynth.baseVoice, 'Kore');
  assert.ok(baseSynth.pitch < 0.96, `Expected lower pitch for deep male embedding, got ${baseSynth.pitch}`);
  assert.ok(baseSynth.stylePrompt.includes(maleEmb.vectorId));

  // Tweaking pitch & speed sliders MUST immediately produce updated synthesis parameters
  const tweaked = resolveClonedVoiceSynthesis({
    name: 'Giọng Trầm',
    embedding: maleEmb,
    tone: { ...DEFAULT_VOICE_TONE, warmthDb: 8, clarityDb: 6, pitch: 1.25, rate: 1.3 },
    ageGroup: 'middle',
    personality: 'cold',
    instruction: 'Đọc trầm chậm, uy lực',
  });

  assert.ok(tweaked.pitch > baseSynth.pitch + 0.08);
  assert.ok(tweaked.rate > baseSynth.rate + 0.15);
  assert.ok(tweaked.warmthDb > baseSynth.warmthDb);
  assert.ok(tweaked.clarityDb > baseSynth.clarityDb);
});
