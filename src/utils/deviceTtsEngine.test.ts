import test from 'node:test';
import assert from 'node:assert/strict';
import {
  splitSpeechIntoChunks,
  getOnDeviceVoiceTone,
  mapLangCodeToSpeechLocale,
} from './deviceTtsEngine';
import { normalizeReadingSpeed, stepReadingSpeed } from './audioFilterEngine';

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
  assert.equal(stepReadingSpeed(1.2, 1), 1.3);
  assert.equal(stepReadingSpeed(1.2, -1), 1.1);
  assert.equal(normalizeReadingSpeed('1,46'), 1.5);
  assert.equal(mapLangCodeToSpeechLocale('vi'), 'vi-VN');
  assert.equal(mapLangCodeToSpeechLocale('en'), 'en-US');
  assert.equal(mapLangCodeToSpeechLocale('ja'), 'ja-JP');
});

