import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

interface ThumbRect {
  left: number;
  top: number;
  width: number;
  height: number;
  ready: boolean;
}

/**
 * Measures the active child button inside a segmented bar and drives a
 * smooth iPhone-style transparent glass water-drop capsule that physically
 * glides between options (supports both single-row and multi-row grids).
 */
export function useLiquidDropIndicator(
  activeKey: string,
  containerRef: React.RefObject<HTMLElement | null>
) {
  const [thumb, setThumb] = useState<ThumbRect>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
  });
  const [isGliding, setIsGliding] = useState(false);
  const prevKeyRef = useRef(activeKey);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeEl = container.querySelector<HTMLElement>(
      `[data-liquid-key="${CSS.escape(activeKey)}"]`
    );
    if (!activeEl) {
      setThumb((prev) => (prev.ready ? { ...prev, ready: false } : prev));
      return;
    }
    const nextLeft = activeEl.offsetLeft;
    const nextTop = activeEl.offsetTop;
    const nextWidth = activeEl.offsetWidth;
    const nextHeight = activeEl.offsetHeight;
    if (nextWidth === 0 || nextHeight === 0) return;

    setThumb((prev) => {
      if (
        prev.ready &&
        Math.abs(prev.left - nextLeft) < 0.5 &&
        Math.abs(prev.top - nextTop) < 0.5 &&
        Math.abs(prev.width - nextWidth) < 0.5 &&
        Math.abs(prev.height - nextHeight) < 0.5
      ) {
        return prev;
      }
      return {
        left: nextLeft,
        top: nextTop,
        width: nextWidth,
        height: nextHeight,
        ready: true,
      };
    });
  }, [activeKey, containerRef]);

  useLayoutEffect(() => {
    measure();
    if (prevKeyRef.current !== activeKey) {
      prevKeyRef.current = activeKey;
      setIsGliding(true);
      const timer = window.setTimeout(() => setIsGliding(false), 320);
      return () => window.clearTimeout(timer);
    }
  }, [activeKey, measure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const raf = window.requestAnimationFrame(measure);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => measure());
      ro.observe(container);
    }
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [containerRef, measure]);

  return { thumb, isGliding };
}

interface LiquidDropThumbProps {
  thumb: ThumbRect;
  isGliding?: boolean;
  roundedClass?: string;
}

export const LiquidDropThumb: React.FC<LiquidDropThumbProps> = ({
  thumb,
  isGliding = false,
  roundedClass = 'rounded-full',
}) => {
  if (!thumb.ready) return null;
  return (
    <span
      aria-hidden="true"
      className={`liquid-waterdrop-thumb pointer-events-none absolute left-0 top-0 z-0 ${roundedClass} ${
        isGliding ? 'liquid-waterdrop-gliding' : ''
      }`}
      style={{
        width: `${thumb.width}px`,
        height: `${thumb.height}px`,
        transform: `translate3d(${thumb.left}px, ${thumb.top}px, 0)`,
      }}
    />
  );
};
