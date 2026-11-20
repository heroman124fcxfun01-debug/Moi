import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitSpeechIntoChunks,
  getOnDeviceVoiceTone,
  mapLangCodeToSpeechLocale,
  pickBestNativeVoiceIndex,
  computeExternalVoiceSpeechParams,
} from './deviceTtsEngine';
import { normalizeReadingSpeed, stepReadingSpeed } from './audioFilterEngine';
import type { ExternalVoiceAsset } from '../types/book';

test('splitSpeechIntoChunks divides long prose cleanly on sentence boundaries', () => {
  const prose =
    'Câu thứ nhất khá dài để thử nghiệm việc tách câu chuẩn xác. Câu thứ hai cũng có độ dài tương đối ổn định để kiểm tra ranh giới dấu chấm. Câu thứ ba kết thúc đoạn văn.';
  const chunks = splitSpeechIntoChunks(prose, 95);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 95);
  }
});

test('getOnDeviceVoiceTone, reading speed step 0.1, and locale mapping operate cleanly', () => {
  assert.equal(getOnDeviceVoiceTone('Charon').preferGender, 'male');
  assert.equal(getOnDeviceVoiceTone('Aoede').preferGender, 'female');
  assert.ok(getOnDeviceVoiceTone('Fenrir').pitch < getOnDeviceVoiceTone('Kore').pitch - 0.3);
  assert.ok(getOnDeviceVoiceTone('Aoede').pitch > getOnDeviceVoiceTone('Kore').pitch + 0.3);
  assert.equal(stepReadingSpeed(1.2, 1), 1.3);
  assert.equal(stepReadingSpeed(1.2, -1), 1.1);
  assert.equal(normalizeReadingSpeed('1,46'), 1.5);
  assert.equal(mapLangCodeToSpeechLocale('vi'), 'vi-VN');
  assert.equal(mapLangCodeToSpeechLocale('en'), 'en-US');
  assert.equal(mapLangCodeToSpeechLocale('ja'), 'ja-JP');
});

test('pickBestNativeVoiceIndex prioritizes -local Android voices over -network and differentiates male/female', () => {
  const androidVoices = [
    { name: 'vi-vn-x-vid-network', voiceURI: 'vi-vn-x-vid-network', lang: 'vi_VN' },
    { name: 'vi-vn-x-vif-network', voiceURI: 'vi-vn-x-vif-network', lang: 'vi_VN' },
    { name: 'vi-vn-x-vid-local', voiceURI: 'vi-vn-x-vid-local', lang: 'vie-VNM' },
    { name: 'vi-vn-x-vif-local', voiceURI: 'vi-vn-x-vif-local', lang: 'vi-VN' },
  ];

  const maleIdx = pickBestNativeVoiceIndex(androidVoices, 'vi-VN', undefined, 'male', 1);
  const femaleIdx = pickBestNativeVoiceIndex(androidVoices, 'vi-VN', undefined, 'female', 0);

  assert.equal(maleIdx, 2, 'Should pick -local male Vietnamese voice instead of -network');
  assert.equal(femaleIdx, 3, 'Should pick -local female Vietnamese voice instead of -network');
});

test('computeExternalVoiceSpeechParams preserves AI-analyzed imported voice timbre instead of collapsing to Kore 1.0', () => {
  const deepImportedMale: ExternalVoiceAsset = {
    id: 'voice-import-deep-1',
    name: 'Giọng Nam Trầm Import',
    fileName: 'nam-tram.mp3',
    mimeType: 'audio/mpeg',
    dataUrl: 'data:audio/mpeg;base64,AAA=',
    originType: 'imported',
    toneSettings: {
      warmthDb: 6,
      clarityDb: 1,
      pitch: 0.76,
      rate: 0.94,
      styleDirection: 'Deep warm baritone Vietnamese narrator',
    },
    analyzedProfile: {
      description: 'Giọng nam trầm dày',
      stylePrompt: 'Deep warm baritone Vietnamese narrator',
      recommendedBaseVoice: 'Fenrir',
      gender: 'male',
      pitchHint: 0.76,
      rateHint: 0.94,
      warmthDb: 6,
      clarityDb: 1,
      analyzedBy: 'gemini-ai',
    },
    addedAt: Date.now(),
  };

  const brightImportedFemale: ExternalVoiceAsset = {
    id: 'voice-import-bright-2',
    name: 'Giọng Nữ Sáng Import',
    fileName: 'nu-sang.mp3',
    mimeType: 'audio/mpeg',
    dataUrl: 'data:audio/mpeg;base64,BBB=',
    originType: 'imported',
    analyzedProfile: {
      description: 'Giọng nữ cao trong trẻo',
      stylePrompt: 'Bright crisp young female voice',
      recommendedBaseVoice: 'Aoede',
      gender: 'female',
      pitchHint: 1.32,
      rateHint: 1.06,
      warmthDb: -2,
      clarityDb: 5,
      analyzedBy: 'gemini-ai',
    },
    addedAt: Date.now(),
  };

  const pMale = computeExternalVoiceSpeechParams(deepImportedMale);
  const pFemale = computeExternalVoiceSpeechParams(brightImportedFemale);

  assert.equal(pMale.baseVoice, 'Fenrir');
  assert.equal(pMale.preferGender, 'male');
  assert.ok(pMale.pitch < 0.8);
  assert.equal(pMale.warmthDb, 6);

  assert.equal(pFemale.baseVoice, 'Aoede');
  assert.equal(pFemale.preferGender, 'female');
  assert.ok(pFemale.pitch > 1.25);
  assert.equal(pFemale.clarityDb, 5);
  assert.notEqual(pMale.stylePrompt, pFemale.stylePrompt);
});
