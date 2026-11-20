import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GLOBAL_VOICE,
  buildUnifiedFontCatalog,
  hideSystemVoiceKey,
  isProtectedPrimaryVoice,
  resolveNarratorAssignmentFromDefault,
} from './studioCatalog';
import {
  formatReadingSpeed,
  normalizeReadingSpeed,
  stepReadingSpeed,
} from './audioFilterEngine';
import type { CustomFontAsset, ExternalVoiceAsset } from '../types/book';

test('buildUnifiedFontCatalog lists community fonts first, then device/classic fonts, then imported fonts in one flat list', () => {
  const customFont: CustomFontAsset = {
    id: 'cf-1',
    name: 'My Serif',
    fontFamily: 'MySerifCustom',
    fileName: 'MySerif.ttf',
    format: 'ttf',
    dataUrl: 'data:font/ttf;base64,AAAA',
    addedAt: 1000,
  };

  const list = buildUnifiedFontCatalog([customFont]);
  assert.ok(list.length >= 18);
  // First 9 are community E-Reader fonts
  assert.equal(list[0].kind, 'community');
  assert.equal(list[0].name, 'Literata');
  assert.equal(list[8].kind, 'community');
  // Followed by device/builtin fonts including native phone fonts
  assert.equal(list[9].kind, 'device');
  assert.ok(list.some((f) => f.id === 'device-system-serif' && f.kind === 'device'));
  assert.ok(list.some((f) => f.id === 'device-system-sans' && f.kind === 'device'));
  // Imported fonts merged at the end seamlessly
  const last = list[list.length - 1];
  assert.equal(last.kind, 'imported');
  assert.equal(last.customFontId, 'cf-1');
  assert.equal(last.name, 'My Serif');
});

test('resolveNarratorAssignmentFromDefault applies global default voice across gemini, external, and device voices', () => {
  const extVoice: ExternalVoiceAsset = {
    id: 'voice-import-1',
    name: 'Giọng Trầm Import',
    fileName: 'tram.mp3',
    mimeType: 'audio/mpeg',
    dataUrl: 'data:audio/mpeg;base64,AAA',
    originType: 'imported',
    originLabel: 'File voice gốc import',
    toneSettings: {
      warmthDb: 6,
      clarityDb: 3,
      pitch: 0.9,
      rate: 1.05,
      styleDirection: 'Ấm trầm truyền cảm',
    },
    analyzedProfile: {
      description: 'File voice gốc import',
      stylePrompt: 'Ấm trầm truyền cảm',
      recommendedBaseVoice: 'Charon',
      pitchHint: 0.9,
      rateHint: 1.05,
    },
    addedAt: 1000,
  };

  // Default fallback
  const fallback = resolveNarratorAssignmentFromDefault(undefined, []);
  assert.equal(fallback.source, 'gemini');
  assert.equal(fallback.geminiVoice, DEFAULT_GLOBAL_VOICE.geminiVoice);

  // Selected Gemini voice
  const charon = resolveNarratorAssignmentFromDefault(
    { source: 'gemini', id: 'gemini:Charon', label: 'Nam trầm ấm', geminiVoice: 'Charon' },
    []
  );
  assert.equal(charon.source, 'gemini');
  assert.equal(charon.geminiVoice, 'Charon');

  // Selected external/studio voice carries EQ toneSettings
  const ext = resolveNarratorAssignmentFromDefault(
    {
      source: 'external',
      id: 'external:voice-import-1',
      label: 'Giọng Trầm Import',
      externalVoiceId: 'voice-import-1',
    },
    [extVoice]
  );
  assert.equal(ext.source, 'external');
  assert.equal(ext.externalVoiceId, 'voice-import-1');
  assert.equal(ext.geminiVoice, 'Charon');
  assert.equal(ext.toneSettings?.warmthDb, 6);

  // Selected device native TTS voice
  const dev = resolveNarratorAssignmentFromDefault(
    {
      source: 'browser',
      id: 'browser:vi-VN-default',
      label: 'Tiếng Việt (Máy)',
      browserVoiceURI: 'vi-VN-default',
    },
    []
  );
  assert.equal(dev.source, 'browser');
  assert.equal(dev.browserVoiceURI, 'vi-VN-default');
});

test('reading speed helpers support direct numeric entry with 0.1 step, comma decimals, and clamping', () => {
  assert.equal(normalizeReadingSpeed('1.3'), 1.3);
  assert.equal(normalizeReadingSpeed('1,4'), 1.4);
  assert.equal(normalizeReadingSpeed('1.26'), 1.3);
  assert.equal(normalizeReadingSpeed('0.1'), 0.5);
  assert.equal(normalizeReadingSpeed('5.0'), 3.0);
  assert.equal(normalizeReadingSpeed('abc', 1.2), 1.2);
  assert.equal(stepReadingSpeed(1.1, 1), 1.2);
  assert.equal(stepReadingSpeed(1.2, -1), 1.1);
  assert.equal(stepReadingSpeed(0.5, -1), 0.5);
  assert.equal(stepReadingSpeed(3.0, 1), 3.0);
  assert.equal(formatReadingSpeed(2), '2.0');
  assert.equal(formatReadingSpeed(1.3), '1.3');
});

test('only the first system voice (gemini:Kore) is protected from deletion; all other built-in and device voices can be deleted', () => {
  assert.equal(isProtectedPrimaryVoice('gemini:Kore'), true);
  assert.equal(isProtectedPrimaryVoice('gemini:Charon'), false);
  assert.equal(isProtectedPrimaryVoice('gemini:Zephyr'), false);
  assert.equal(isProtectedPrimaryVoice('gemini:Fenrir'), false);
  assert.equal(isProtectedPrimaryVoice('gemini:Puck'), false);
  assert.equal(isProtectedPrimaryVoice('gemini:Aoede'), false);
  assert.equal(isProtectedPrimaryVoice('browser:vi-VN-default'), false);
  assert.equal(isProtectedPrimaryVoice('external:voice-123'), false);

  // Attempting to hide the protected first voice must not include it
  const afterProtected = hideSystemVoiceKey('gemini:Kore');
  assert.equal(afterProtected.includes('gemini:Kore'), false);
});

