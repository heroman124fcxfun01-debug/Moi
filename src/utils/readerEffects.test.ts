import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_TURN_STYLES,
  computeCornerCurlGeometry,
  computeInteractiveCornerCurlDrag,
  computeInteractiveCurlTransform,
  computeInteractiveSlideFade,
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

test('computeCornerCurlGeometry peels diagonally upward from bottom-right corner with curved flap', () => {
  const flat = computeCornerCurlGeometry(0);
  assert.equal(flat.peel, 0);
  assert.equal(flat.flapPath, '');

  const mid = computeCornerCurlGeometry(0.35);
  assert.ok(mid.frontClipPath.startsWith('polygon('));
  assert.ok(mid.flapPath.includes(' Q '), 'flap should use quadratic Bezier curves for rolled paper');
  assert.ok(mid.tipX < 100 && mid.tipY < 100, 'lifted corner tip moves up-and-left from bottom-right');
  assert.ok(mid.shadowOpacity > 0.2, 'mid-peel casts visible shadow onto underlying page');

  const full = computeCornerCurlGeometry(1);
  assert.equal(full.flapPath, '');
  assert.equal(full.shadowOpacity, 0);
});

test('computeInteractiveCornerCurlDrag combines horizontal and upward corner drag smoothly', () => {
  const small = computeInteractiveCornerCurlDrag(-25, -10, 390, 700);
  assert.equal(small.direction, 'next');
  assert.equal(small.shouldCommitFlip, false);
  assert.ok(small.progress > 0 && small.progress < 0.18);

  const diagonal = computeInteractiveCornerCurlDrag(-80, -90, 390, 700);
  assert.equal(diagonal.direction, 'next');
  assert.equal(diagonal.shouldCommitFlip, true);
  assert.ok(diagonal.progress >= 0.25);
});

test('computeInteractiveSlideFade glides page horizontally and progressively fades opacity on hold-drag', () => {
  const startDrag = computeInteractiveSlideFade(-24, 390);
  assert.equal(startDrag.direction, 'next');
  assert.equal(startDrag.translateXPx, -24);
  assert.ok(startDrag.opacity < 0.95 && startDrag.opacity > 0.7, 'begins fading immediately as user drags');
  assert.equal(startDrag.shouldCommitFlip, false);

  const deepDrag = computeInteractiveSlideFade(-180, 390);
  assert.equal(deepDrag.direction, 'next');
  assert.equal(deepDrag.translateXPx, -180);
  assert.ok(deepDrag.opacity < 0.55, 'fades strongly as page moves left');
  assert.equal(deepDrag.shouldCommitFlip, true);
});


