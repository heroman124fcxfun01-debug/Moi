import React, { useEffect, useRef, useState } from 'react';
import { triggerDeviceHaptic } from '../utils/deviceHardware';

interface PressHoldSliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (nextValue: number) => void;
  ariaLabel?: string;
  testId?: string;
  holdMs?: number;
  className?: string;
}

function clampAndStep(raw: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, raw));
  const stepped = Math.round((clamped - min) / step) * step + min;
  const decimals = step.toString().includes('.') ? step.toString().split('.')[1].length : 0;
  return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
}

/**
 * Press-and-Hold + Drag Slider (Anti-Accidental Tap-to-Jump):
 * - Single light taps anywhere on the track are IGNORED (value does NOT jump while scrolling).
 * - Value updates ONLY when the user presses & holds (>= holdMs) and drags, OR drags starting on the thumb.
 * - Full keyboard & accessibility support preserved via a hidden/synchronized ARIA slider role.
 */
export const PressHoldSlider: React.FC<PressHoldSliderProps> = ({
  min,
  max,
  step = 1,
  value,
  onChange,
  ariaLabel,
  testId,
  holdMs = 140,
  className = '',
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<number | null>(null);
  const pointerStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startedOnThumb: boolean;
    engaged: boolean;
  } | null>(null);
  const [isEngaged, setIsEngaged] = useState(false);

  const percent = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  useEffect(() => () => clearHoldTimer(), []);

  const computeValueFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return value;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return clampAndStep(min + ratio * (max - min), min, max, step);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const thumbX = rect.left + (percent / 100) * rect.width;
    const startedOnThumb = Math.abs(e.clientX - thumbX) <= 18;

    clearHoldTimer();
    pointerStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startedOnThumb,
      engaged: false,
    };

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }

    // Require intentional press-and-hold before engaging drag — single tap NEVER jumps value!
    holdTimerRef.current = window.setTimeout(() => {
      const st = pointerStateRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      st.engaged = true;
      setIsEngaged(true);
      triggerDeviceHaptic('tap', true);
    }, holdMs);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = pointerStateRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const dx = Math.abs(e.clientX - st.startX);
    const dy = Math.abs(e.clientY - st.startY);

    // If user is vertically scrolling the sheet before hold engages, cancel slider capture cleanly
    if (!st.engaged && dy > 8 && dy > dx) {
      clearHoldTimer();
      pointerStateRef.current = null;
      return;
    }

    // If user grabbed the thumb directly and dragged horizontally >= 6px, engage immediately
    if (!st.engaged && st.startedOnThumb && dx >= 6 && dx >= dy) {
      clearHoldTimer();
      st.engaged = true;
      setIsEngaged(true);
    }

    if (st.engaged) {
      e.preventDefault();
      const next = computeValueFromClientX(e.clientX);
      if (next !== value) {
        onChange(next);
      }
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = pointerStateRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    clearHoldTimer();
    pointerStateRef.current = null;
    setIsEngaged(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(clampAndStep(value + step, min, max, step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(clampAndStep(value - step, min, max, step));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onChange(min);
    } else if (e.key === 'End') {
      e.preventDefault();
      onChange(max);
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      data-testid={testId}
      data-press-hold-slider="true"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointer}
      onPointerCancel={finishPointer}
      onKeyDown={handleKeyDown}
      style={{ touchAction: isEngaged ? 'none' : 'pan-y' }}
      className={`relative h-5 flex items-center select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700/40 rounded-full ${className}`}
    >
      {/* Track background */}
      <div className="w-full h-1.5 rounded-full bg-stone-200 dark:bg-stone-700 overflow-hidden pointer-events-none">
        <div
          className="h-full rounded-full bg-amber-800 dark:bg-amber-500 transition-[width] duration-75"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Thumb */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-amber-800 dark:bg-amber-400 border-2 border-white dark:border-stone-900 shadow-sm transition-transform duration-100 ${
          isEngaged ? 'scale-125 ring-4 ring-amber-700/25' : 'scale-100'
        }`}
        style={{ left: `${percent}%` }}
      />
    </div>
  );
};
