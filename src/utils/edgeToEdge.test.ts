import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateReaderTapZone,
  isLightBackgroundHex,
  shouldShowReturnToListeningPill,
} from './edgeToEdge';

test('isLightBackgroundHex accurately chooses black vs white status bar icons', () => {
  assert.equal(isLightBackgroundHex('#FFFFFF'), true);
  assert.equal(isLightBackgroundHex('#F6EED9'), true); // Warm paper
  assert.equal(isLightBackgroundHex('#F7F4EE'), true); // Light app bg
  assert.equal(isLightBackgroundHex('#141518'), false); // Night mode
  assert.equal(isLightBackgroundHex('#000000'), false); // AMOLED black
  assert.equal(isLightBackgroundHex('#1E222B'), false); // Dark slate
});

test('evaluateReaderTapZone splits left 30%, center 40% menu toggle, and right 30%', () => {
  assert.equal(evaluateReaderTapZone(0.1).zone, 'prev');
  assert.equal(evaluateReaderTapZone(0.29).zone, 'prev');
  assert.equal(evaluateReaderTapZone(0.35).zone, 'center-menu');
  assert.equal(evaluateReaderTapZone(0.5).zone, 'center-menu');
  assert.equal(evaluateReaderTapZone(0.68).zone, 'center-menu');
  assert.equal(evaluateReaderTapZone(0.75).zone, 'next');
  assert.equal(evaluateReaderTapZone(0.95).zone, 'next');
});

test('shouldShowReturnToListeningPill appears only when listening is active on another page or chapter', () => {
  assert.equal(
    shouldShowReturnToListeningPill({
      isListeningActive: false,
      listeningChapterIndex: 0,
      listeningPageIndex: 1,
      currentChapterIndex: 0,
      currentPageIndex: 3,
      isPaginatedMode: true,
    }),
    false
  );

  assert.equal(
    shouldShowReturnToListeningPill({
      isListeningActive: true,
      listeningChapterIndex: 0,
      listeningPageIndex: 2,
      currentChapterIndex: 0,
      currentPageIndex: 2,
      isPaginatedMode: true,
    }),
    false
  );

  assert.equal(
    shouldShowReturnToListeningPill({
      isListeningActive: true,
      listeningChapterIndex: 0,
      listeningPageIndex: 2,
      currentChapterIndex: 0,
      currentPageIndex: 5,
      isPaginatedMode: true,
    }),
    true
  );

  assert.equal(
    shouldShowReturnToListeningPill({
      isListeningActive: true,
      listeningChapterIndex: 0,
      listeningPageIndex: 2,
      currentChapterIndex: 1,
      currentPageIndex: 0,
      isPaginatedMode: true,
    }),
    true
  );
});
