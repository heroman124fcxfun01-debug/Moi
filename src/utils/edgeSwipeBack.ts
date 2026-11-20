export const RIGHT_EDGE_ZONE_PX = 32;
export const EDGE_SWIPE_COMMIT_DX = 64;

export interface EdgeSwipeStart {
  startX: number;
  startY: number;
  viewportWidth: number;
}

/**
 * Returns true if a pointer/touch started inside the right screen edge zone
 * (Android/iOS-style right-edge inward swipe-back gesture).
 */
export function isInRightEdgeBackZone(
  clientX: number,
  viewportWidth: number,
  edgeZonePx = RIGHT_EDGE_ZONE_PX
): boolean {
  if (!Number.isFinite(clientX) || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    return false;
  }
  return clientX >= viewportWidth - edgeZonePx;
}

/**
 * Evaluates a right-edge-to-left drag delta and returns progress [0..1]
 * plus whether releasing at this delta should navigate back to the main screen.
 */
export function evaluateRightEdgeBackSwipe(
  start: EdgeSwipeStart,
  currentX: number,
  currentY: number,
  commitDx = EDGE_SWIPE_COMMIT_DX
): {
  isValidEdgeGesture: boolean;
  isHorizontalBack: boolean;
  progress: number;
  shouldNavigateBack: boolean;
  pullDistancePx: number;
} {
  const isValidEdgeGesture = isInRightEdgeBackZone(start.startX, start.viewportWidth);
  if (!isValidEdgeGesture) {
    return {
      isValidEdgeGesture: false,
      isHorizontalBack: false,
      progress: 0,
      shouldNavigateBack: false,
      pullDistancePx: 0,
    };
  }

  const dx = currentX - start.startX; // leftward swipe is negative
  const dy = currentY - start.startY;
  const leftwardPx = Math.max(0, -dx);
  const isHorizontalBack = leftwardPx > 12 && leftwardPx > Math.abs(dy) * 1.15;
  const progress = isHorizontalBack ? Math.min(1, leftwardPx / commitDx) : 0;
  const shouldNavigateBack = isHorizontalBack && leftwardPx >= commitDx;

  return {
    isValidEdgeGesture: true,
    isHorizontalBack,
    progress,
    shouldNavigateBack,
    pullDistancePx: isHorizontalBack ? Math.min(commitDx * 1.3, leftwardPx) : 0,
  };
}
