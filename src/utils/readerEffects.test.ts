import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_TURN_STYLES,
  computeInteractiveCurlTransform,
  getPageTurnAnimationClass,
  getVintagePaperTextureStyles,
  isVintagePaperTheme,
} from './readerEffects';

test('PAGE_TURN_STYLES provides 6 distinct page flip styles including curl, slide, flip3d, cover, fade, none', () => {
  const ids = PAGE_TURN_STYLES.map((s) => s.id);
  assert.deepEqual(ids, ['curl', 'slide', 'flip3d', 'cover', 'fade', 'none']);
});

test('getPageTurnAnimationClass resolves directional CSS classes accurately', () => {
  assert.equal(getPageTurnAnimationClass('curl', 'next'), 'page-turn-curl-next');
  assert.equal(getPageTurnAnimationClass('curl', 'prev'), 'page-turn-curl-prev');
  assert.equal(getPageTurnAnimationClass('flip3d', 'next'), 'page-turn-flip3d-next');
  assert.equal(getPageTurnAnimationClass('fade', 'prev'), 'page-turn-fade');
  assert.equal(getPageTurnAnimationClass('none', 'next'), '');
});

test('vintage yellowed paper themes return warm parchment textures and inset shadows', () => {
  assert.equal(isVintagePaperTheme('vintage_yellow'), true);
  assert.equal(isVintagePaperTheme('parchment'), true);
  assert.equal(isVintagePaperTheme('newsprint'), true);
  assert.equal(isVintagePaperTheme('amber_aged'), true);
  assert.equal(isVintagePaperTheme('oled'), false);

  const vintage = getVintagePaperTextureStyles('vintage_yellow');
  assert.ok(vintage.backgroundImage && vintage.backgroundImage.includes('radial-gradient'));
  assert.ok(vintage.boxShadow && vintage.boxShadow.includes('inset'));
});

test('computeInteractiveCurlTransform tracks drag ratio and flips when drag exceeds threshold', () => {
  const smallDrag = computeInteractiveCurlTransform(-30, 400);
  assert.equal(smallDrag.direction, 'next');
  assert.equal(smallDrag.shouldCommitFlip, false);
  assert.ok(smallDrag.rotateYDeg < 0);

  const commitNext = computeInteractiveCurlTransform(-100, 400);
  assert.equal(commitNext.direction, 'next');
  assert.equal(commitNext.progress, 0.25);
  assert.equal(commitNext.shouldCommitFlip, true);

  const commitPrev = computeInteractiveCurlTransform(120, 400);
  assert.equal(commitPrev.direction, 'prev');
  assert.ok(commitPrev.rotateYDeg > 0);
  assert.equal(commitPrev.shouldCommitFlip, true);
});

