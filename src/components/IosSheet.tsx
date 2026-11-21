import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type IosSheetVariant =
  | 'bottom-sheet'
  | 'drawer-right'
  | 'drawer-left'
  | 'popover-top-right'
  | 'center-dialog';

interface IosSheetProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  variant?: IosSheetVariant;
  zIndexClass?: string;
  panelClassName?: string;
  backdropClassName?: string;
  showGrabHandle?: boolean;
  enableSwipeDownToClose?: boolean;
  inlineDesktop?: boolean;
  testId?: string;
  children: React.ReactNode;
}

const EXIT_DURATION_MS = 230;

/**
 * iPhone-grade animated modal / bottom-sheet / side-drawer container:
 * - Keeps content mounted during exit so closing glides smoothly instead of popping out.
 * - Supports native-feeling swipe-down-to-dismiss on mobile bottom sheets with rubber-band damping.
 * - Strictly GPU-composited (transform + opacity only) for 120fps motion.
 */
export const IosSheet: React.FC<IosSheetProps> = ({
  isOpen,
  onClose,
  ariaLabel,
  variant = 'bottom-sheet',
  zIndexClass = 'z-[75]',
  panelClassName = '',
  backdropClassName = '',
  showGrabHandle = false,
  enableSwipeDownToClose = true,
  inlineDesktop = false,
  testId,
  children,
}) => {
  const [rendered, setRendered] = useState(isOpen);
  const [phase, setPhase] = useState<'enter' | 'exit'>(isOpen ? 'enter' : 'exit');
  const [dragY, setDragY] = useState(0);
  const dragStartYRef = useRef<number | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      setPhase('enter');
      setDragY(0);
      return;
    }
    setPhase('exit');
    const timer = window.setTimeout(() => {
      setRendered(false);
      setDragY(0);
    }, EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!rendered) return null;

  const canSwipeDown =
    enableSwipeDownToClose &&
    !inlineDesktop &&
    (variant === 'bottom-sheet' || variant === 'popover-top-right');

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canSwipeDown) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragStartYRef.current = e.clientY;
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer events
    }
  };

  const handleDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || dragStartYRef.current === null) return;
    const rawDy = e.clientY - dragStartYRef.current;
    // Rubber-band resistance when pulling upward; 1:1 follow when pulling downward
    const nextDy = rawDy >= 0 ? rawDy : rawDy * 0.18;
    setDragY(nextDy);
  };

  const handleDragEnd = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    dragStartYRef.current = null;
    if (dragY > 72) {
      setDragY(0);
      onClose();
    } else {
      setDragY(0);
    }
  };

  const animClass =
    variant === 'drawer-right'
      ? phase === 'enter'
        ? 'ios-drawer-right-in'
        : 'ios-drawer-right-out'
      : variant === 'drawer-left'
      ? phase === 'enter'
        ? 'ios-drawer-left-in'
        : 'ios-drawer-left-out'
      : variant === 'popover-top-right'
      ? phase === 'enter'
        ? 'ios-popover-in'
        : 'ios-popover-out'
      : variant === 'center-dialog'
      ? phase === 'enter'
        ? 'ios-dialog-in'
        : 'ios-dialog-out'
      : phase === 'enter'
      ? 'ios-sheet-in'
      : 'ios-sheet-out';

  const dragStyle: React.CSSProperties | undefined =
    dragY !== 0
      ? {
          transform: `translate3d(0, ${Math.round(dragY)}px, 0)`,
          transition: 'none',
          animation: 'none',
        }
      : undefined;

  // Docked desktop sidebar mode (no full-screen backdrop)
  if (inlineDesktop) {
    return (
      <aside
        aria-label={ariaLabel}
        data-testid={testId}
        className={`${animClass} ios-frosted-surface ${panelClassName}`}
      >
        {children}
      </aside>
    );
  }

  if (typeof document === 'undefined') return null;

  const wrapperAlign =
    variant === 'drawer-left'
      ? 'items-end sm:items-start sm:justify-start'
      : variant === 'drawer-right'
      ? 'items-end sm:items-start sm:justify-end'
      : variant === 'popover-top-right'
      ? 'items-end sm:items-start sm:justify-end p-0 sm:pt-[60px] sm:pr-5'
      : variant === 'center-dialog'
      ? 'items-end sm:items-center justify-center p-3 pb-10 sm:p-4'
      : 'items-end justify-center';

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex ${wrapperAlign} ${
        phase === 'exit' ? 'pointer-events-none' : 'pointer-events-auto'
      }`}
    >
      <div
        className={`fixed inset-0 ios-frosted-backdrop ${
          phase === 'enter' ? 'ios-backdrop-in' : 'ios-backdrop-out'
        } ${backdropClassName}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        data-testid={testId}
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
        className={`relative z-10 ios-frosted-surface ${animClass} ${panelClassName}`}
      >
        {showGrabHandle && (
          <div
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
            className="sm:hidden flex justify-center pt-2 pb-1.5 shrink-0 cursor-grab active:cursor-grabbing touch-none"
          >
            <span className="w-10 h-1 rounded-full bg-stone-400/55 dark:bg-stone-600/75" />
          </div>
        )}
        {children}
      </aside>
    </div>,
    document.body
  );
};
