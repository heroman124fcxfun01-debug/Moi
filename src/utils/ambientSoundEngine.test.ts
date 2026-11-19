import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_AMBIENT_SOUNDS,
  clampAmbientVolume,
  filterAmbientSounds,
  mixEffectiveVolume,
} from './ambientSoundEngine.ts';

test('BUILTIN_AMBIENT_SOUNDS includes 20 distinct nature, space, and chill sounds', () => {
  assert.equal(BUILTIN_AMBIENT_SOUNDS.length, 20);
  const ids = new Set(BUILTIN_AMBIENT_SOUNDS.map((s) => s.id));
  assert.equal(ids.size, 20);

  const hasRain = BUILTIN_AMBIENT_SOUNDS.some((s) => s.name.toLowerCase().includes('mưa'));
  const hasFire = BUILTIN_AMBIENT_SOUNDS.some((s) => s.name.toLowerCase().includes('lửa'));
  const hasChill = BUILTIN_AMBIENT_SOUNDS.some((s) => s.category === 'chill');

  assert.equal(hasRain, true);
  assert.equal(hasFire, true);
  assert.equal(hasChill, true);
});

test('filterAmbientSounds filters accurately by category and Vietnamese query', () => {
  const chillOnly = filterAmbientSounds(BUILTIN_AMBIENT_SOUNDS, 'chill', '');
  assert.equal(chillOnly.length, 5);
  assert.ok(chillOnly.every((s) => s.category === 'chill'));

  const rainMatches = filterAmbientSounds(BUILTIN_AMBIENT_SOUNDS, 'all', 'mưa');
  assert.ok(rainMatches.length >= 2);
});

test('clampAmbientVolume and mixEffectiveVolume clamp safely between 0 and 1', () => {
  assert.equal(clampAmbientVolume(-0.4), 0);
  assert.equal(clampAmbientVolume(1.5), 1);
  assert.equal(mixEffectiveVolume(0.5, 0.8), 0.4);
});
