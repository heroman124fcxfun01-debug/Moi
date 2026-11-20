import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRightEdgeBackSwipe,
  isInRightEdgeBackZone,
} from './edgeSwipeBack.ts';

test('isInRightEdgeBackZone only matches touches starting near the right viewport edge', () => {
  assert.equal(isInRightEdgeBackZone(385, 390), true);
  assert.equal(isInRightEdgeBackZone(360, 390), true);
  assert.equal(isInRightEdgeBackZone(200, 390), false);
  assert.equal(isInRightEdgeBackZone(10, 390), false);
});

test('evaluateRightEdgeBackSwipe commits back navigation on right-to-left edge drag and ignores vertical or mid-screen swipes', () => {
  // Valid right-edge swipe left by 80px -> navigate back
  const committed = evaluateRightEdgeBackSwipe(
    { startX: 382, startY: 400, viewportWidth: 390 },
    302,
    408
  );
  assert.equal(committed.isValidEdgeGesture, true);
  assert.equal(committed.isHorizontalBack, true);
  assert.equal(committed.shouldNavigateBack, true);
  assert.equal(committed.progress, 1);

  // Short drag (32px) -> preview progress 0.5, do not commit yet
  const partial = evaluateRightEdgeBackSwipe(
    { startX: 382, startY: 400, viewportWidth: 390 },
    350,
    404
  );
  assert.equal(partial.isHorizontalBack, true);
  assert.equal(partial.shouldNavigateBack, false);
  assert.ok(partial.progress > 0.4 && partial.progress < 0.6);

  // Vertical scroll near right edge -> must NOT navigate back
  const vertical = evaluateRightEdgeBackSwipe(
    { startX: 382, startY: 400, viewportWidth: 390 },
    340,
    520
  );
  assert.equal(vertical.shouldNavigateBack, false);

  // Normal mid-screen page-turn swipe -> NOT an edge-back gesture
  const midScreen = evaluateRightEdgeBackSwipe(
    { startX: 280, startY: 400, viewportWidth: 390 },
    160,
    402
  );
  assert.equal(midScreen.isValidEdgeGesture, false);
  assert.equal(midScreen.shouldNavigateBack, false);
});
