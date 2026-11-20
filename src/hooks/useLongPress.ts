import { useCallback, useRef, type MouseEvent, type PointerEvent } from 'react';

interface UseLongPressOptions {
  delayMs?: number;
  moveTolerancePx?: number;
  onLongPress: () => void;
}

/**
 * Reliable mobile + desktop long-press (nhấn dí) hook.
 * - Fires after holding pointer/finger still for `delayMs` (default 460ms).
 * - Cancels cleanly if user scrolls/drags past `moveTolerancePx`.
 * - Suppresses the synthetic click immediately after a long-press completes.
 * - Also exposes `onContextMenu` so desktop right-click triggers the same menu.
 */
export function useLongPress({
  delayMs = 460,
  moveTolerancePx = 10,
  onLongPress,
}: UseLongPressOptions) {
  const timerRef = useRef<number | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const triggeredRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPosRef.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      // Ignore secondary mouse clicks here (handled by onContextMenu)
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      triggeredRef.current = false;
      startPosRef.current = { x: e.clientX, y: e.clientY };
      clearTimer();
      startPosRef.current = { x: e.clientX, y: e.clientY };
      timerRef.current = window.setTimeout(() => {
        triggeredRef.current = true;
        timerRef.current = null;
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(14);
          } catch {
            // ignore unsupported haptics
          }
        }
        onLongPress();
      }, delayMs);
    },
    [clearTimer, delayMs, onLongPress]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!startPosRef.current) return;
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);
      if (dx > moveTolerancePx || dy > moveTolerancePx) {
        clearTimer();
      }
    },
    [clearTimer, moveTolerancePx]
  );

  const onPointerUp = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onPointerLeave = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      clearTimer();
      triggeredRef.current = true;
      onLongPress();
    },
    [clearTimer, onLongPress]
  );

  const consumeLongPressClick = useCallback((): boolean => {
    if (triggeredRef.current) {
      triggeredRef.current = false;
      return true;
    }
    return false;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onContextMenu,
    },
    consumeLongPressClick,
  };
}
