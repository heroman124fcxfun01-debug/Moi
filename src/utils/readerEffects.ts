import type { PageTurnStyle, PaperThemeId } from '../types/book';

export interface PageTurnOption {
  id: PageTurnStyle;
  label: string;
  description: string;
}

export const PAGE_TURN_STYLES: PageTurnOption[] = [
  {
    id: 'curl',
    label: 'Cong mép sách (Curl)',
    description: 'Uốn cong trang giấy kèm bóng đổ chân thực như sách thật',
  },
  {
    id: 'slide',
    label: 'Trượt ngang (Slide)',
    description: 'Đẩy trang mượt mà sang trái hoặc phải',
  },
  {
    id: 'flip3d',
    label: 'Lật sách 3D (Flip)',
    description: 'Xoay trang quanh gáy sách theo chiều không gian 3D',
  },
  {
    id: 'cover',
    label: 'Xếp tờ chồng (Cover)',
    description: 'Trang mới trượt phủ lên trang cũ nhẹ nhàng',
  },
  {
    id: 'fade',
    label: 'Mờ dần dịu mắt (Fade)',
    description: 'Chuyển cảnh êm dịu, không gây mỏi mắt ban đêm',
  },
  {
    id: 'none',
    label: 'Chuyển tức thì (E-Ink)',
    description: 'Lật trang ngay lập tức không hiệu ứng như máy đọc sách',
  },
];

export function getPageTurnAnimationClass(
  style: PageTurnStyle | undefined,
  direction: 'next' | 'prev'
): string {
  const effective = style || 'curl';
  if (effective === 'none') return '';
  if (effective === 'fade') return 'page-turn-fade';
  return `page-turn-${effective}-${direction}`;
}

export function isVintagePaperTheme(themeId: PaperThemeId): boolean {
  return (
    themeId === 'sepia' ||
    themeId === 'vintage_yellow' ||
    themeId === 'parchment' ||
    themeId === 'newsprint' ||
    themeId === 'amber_aged'
  );
}

export function getVintagePaperTextureStyles(themeId: PaperThemeId): {
  backgroundImage?: string;
  boxShadow?: string;
} {
  if (themeId === 'vintage_yellow') {
    return {
      backgroundImage:
        'radial-gradient(ellipse at 20% 15%, rgba(255, 248, 224, 0.45), transparent 55%), radial-gradient(ellipse at 85% 85%, rgba(168, 132, 68, 0.16), transparent 60%), repeating-linear-gradient(0deg, rgba(130, 96, 44, 0.018) 0px, rgba(130, 96, 44, 0.018) 1px, transparent 1px, transparent 4px)',
      boxShadow: 'inset 0 0 68px rgba(154, 114, 52, 0.14)',
    };
  }
  if (themeId === 'parchment') {
    return {
      backgroundImage:
        'radial-gradient(ellipse at 50% 40%, rgba(255, 244, 214, 0.35), rgba(145, 102, 42, 0.15) 100%), repeating-linear-gradient(90deg, rgba(110, 74, 28, 0.02) 0px, transparent 2px, transparent 7px)',
      boxShadow: 'inset 0 0 84px rgba(120, 82, 34, 0.2)',
    };
  }
  if (themeId === 'newsprint') {
    return {
      backgroundImage:
        'radial-gradient(circle at 50% 50%, rgba(255, 252, 244, 0.25), rgba(120, 112, 94, 0.12)), repeating-linear-gradient(0deg, rgba(60, 54, 44, 0.02) 0px, rgba(60, 54, 44, 0.02) 1px, transparent 1px, transparent 3px)',
      boxShadow: 'inset 0 0 54px rgba(110, 100, 80, 0.14)',
    };
  }
  if (themeId === 'amber_aged') {
    return {
      backgroundImage:
        'radial-gradient(ellipse at 30% 25%, rgba(255, 250, 220, 0.42), transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(186, 136, 48, 0.18), transparent 65%)',
      boxShadow: 'inset 0 0 72px rgba(170, 124, 44, 0.15)',
    };
  }
  return {};
}

export interface InteractiveCurlTransform {
  progress: number;
  direction: 'next' | 'prev';
  rotateYDeg: number;
  translateXPx: number;
  shadowAlpha: number;
  shouldCommitFlip: boolean;
}

/**
 * Maps live touch/mouse horizontal drag distance (deltaX) across a book stage width
 * to a continuous curl progress and commit threshold.
 */
export function computeInteractiveCurlTransform(
  deltaX: number,
  stageWidth: number
): InteractiveCurlTransform {
  const safeWidth = Math.max(120, stageWidth || 360);
  const progress = Math.min(1, Math.max(0, Math.abs(deltaX) / safeWidth));
  const direction: 'next' | 'prev' = deltaX < 0 ? 'next' : 'prev';
  const sign = direction === 'next' ? -1 : 1;
  return {
    progress,
    direction,
    rotateYDeg: Number((sign * progress * 64).toFixed(2)),
    translateXPx: Number((deltaX * 0.24).toFixed(2)),
    shadowAlpha: Number((progress * 0.26).toFixed(3)),
    shouldCommitFlip: progress >= 0.2,
  };
}

export interface CornerCurlDragResult {
  progress: number;
  direction: 'next' | 'prev';
  shouldCommitFlip: boolean;
}

/**
 * Maps diagonal finger drag (bottom-right pulling up-and-left for Next,
 * or left-to-right for Prev) into a smooth [0..1] paper corner peel ratio.
 */
export function computeInteractiveCornerCurlDrag(
  deltaX: number,
  deltaY: number,
  stageWidth: number,
  stageHeight = 640
): CornerCurlDragResult {
  const safeW = Math.max(140, stageWidth || 360);
  const safeH = Math.max(200, stageHeight || 640);
  const direction: 'next' | 'prev' = deltaX <= 0 ? 'next' : 'prev';
  if (direction === 'next') {
    const pullLeft = Math.max(0, -deltaX) / (safeW * 0.82);
    const pullUp = Math.max(0, -deltaY) / (safeH * 1.15);
    const progress = Math.min(1, Math.max(0, pullLeft + pullUp * 0.35));
    return {
      progress: Number(progress.toFixed(4)),
      direction,
      shouldCommitFlip: progress >= 0.18,
    };
  }
  const pullRight = Math.max(0, deltaX) / (safeW * 0.82);
  const pullDown = Math.max(0, deltaY) / (safeH * 1.15);
  const progress = Math.min(1, Math.max(0, pullRight + pullDown * 0.25));
  return {
    progress: Number(progress.toFixed(4)),
    direction,
    shouldCommitFlip: progress >= 0.18,
  };
}

export interface CornerCurlGeometry {
  /** Normalized peel factor in [0..1], where 0 = flat page, 1 = completely turned off top-left */
  peel: number;
  /** CSS clip-path polygon hiding the peeled-back bottom-right corner on the top page */
  frontClipPath: string;
  /** SVG path (0..100 coordinate space) for the curved underside paper flap */
  flapPath: string;
  /** SVG path (0..100 coordinate space) for the cast shadow falling onto the revealed page underneath */
  castShadowPath: string;
  /** SVG path (0..100 coordinate space) for the soft crease highlight along the curved fold */
  creasePath: string;
  /** Bottom-edge fold point X (0..100) */
  foldBottomX: number;
  /** Right-edge fold point Y (0..100) */
  foldRightY: number;
  /** Reflected lifted paper corner tip coordinates (0..100) */
  tipX: number;
  tipY: number;
  /** Opacity for cast shadow & flap depth */
  shadowOpacity: number;
  /** CSS clip-path polygon for the curled underside paper flap (matching mirrored back-face) */
  flapClipPath: string;
  /** CSS transform to mirror the back-face of current page onto the curled corner */
  backfaceTransform: string;
  /** Specular crease highlight opacity along the curved fold */
  creaseHighlightOpacity: number;
}

/**
 * Computes realistic bottom-right book corner peel geometry in normalized 0..100 coordinates.
 * Unlike rigid rotateY card tilting, the page stays flat in the book spine while its
 * bottom-right corner lifts diagonally upward and curls smoothly across the page.
 */
export function computeCornerCurlGeometry(peelInput: number): CornerCurlGeometry {
  const peel = Math.min(1, Math.max(0, peelInput));
  if (peel <= 0.001) {
    return {
      peel: 0,
      frontClipPath: 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)',
      flapPath: '',
      castShadowPath: '',
      creasePath: '',
      foldBottomX: 100,
      foldRightY: 100,
      tipX: 100,
      tipY: 100,
      shadowOpacity: 0,
      flapClipPath: 'polygon(100% 100%, 100% 100%, 100% 100%)',
      backfaceTransform: 'none',
      creaseHighlightOpacity: 0,
    };
  }

  // Diagonal fold line: x / a + y / b = 1 measured inward from bottom-right corner (100, 100)
  // Using slight steeper diagonal (a slightly narrower than b) gives authentic thumb-corner lift
  const d = peel * 2.08; // reaches 2.08 so the entire 100x100 page clears cleanly by peel = 1
  const rawBottomX = 100 - d * 98; // moves from 100 -> -103.8
  const rawRightY = 100 - d * 106; // moves from 100 -> -120.5

  // Compute exact intersection of the fold line with the 0..100 viewport box
  // Line passes through P1 = (rawBottomX, 100) and P2 = (100, rawRightY)
  const dx = 100 - rawBottomX;
  const dy = rawRightY - 100; // negative

  // Entry point on bottom edge (y = 100) or left edge (x = 0)
  let pAx: number;
  let pAy: number;
  if (rawBottomX >= 0) {
    pAx = rawBottomX;
    pAy = 100;
  } else {
    // Intersect with x = 0: t = (0 - rawBottomX) / dx
    const t = -rawBottomX / dx;
    pAx = 0;
    pAy = Math.max(0, Math.min(100, 100 + t * dy));
  }

  // Exit point on right edge (x = 100) or top edge (y = 0)
  let pBx: number;
  let pBy: number;
  if (rawRightY >= 0) {
    pBx = 100;
    pBy = rawRightY;
  } else {
    // Intersect with y = 0: t = (0 - 100) / dy
    const t = -100 / dy;
    pBx = Math.max(0, Math.min(100, rawBottomX + t * dx));
    pBy = 0;
  }

  // Build clean polygon for remaining visible front page (top-left side of diagonal fold)
  const polyPts: string[] = [];
  if (pAx === 0 && pAy <= 0.2 && pBx <= 0.2 && pBy === 0) {
    polyPts.push('0% 0%', '0% 0%', '0% 0%');
  } else {
    polyPts.push('0% 0%');
    if (pBy === 0) {
      polyPts.push(`${pBx.toFixed(2)}% 0%`);
    } else {
      polyPts.push('100% 0%');
      polyPts.push(`100% ${pBy.toFixed(2)}%`);
    }
    if (pAy === 100) {
      polyPts.push(`${pAx.toFixed(2)}% 100%`);
      polyPts.push('0% 100%');
    } else {
      polyPts.push(`0% ${pAy.toFixed(2)}%`);
    }
  }
  const frontClipPath = `polygon(${polyPts.join(', ')})`;

  // Reflect bottom-right corner (100, 100) across the diagonal fold line to find the lifted paper tip
  const lineLenSq = dx * dx + dy * dy || 1;
  // Vector from P1(rawBottomX, 100) to Corner(100, 100) is (dx, 0)
  const proj = ((100 - rawBottomX) * dx + 0 * dy) / lineLenSq;
  const footX = rawBottomX + proj * dx;
  const footY = 100 + proj * dy;
  // Slight curl foreshortening (0.86) simulates cylindrical roll lifting toward viewer
  const tipX = footX + (footX - 100) * 0.86;
  const tipY = footY + (footY - 100) * 0.86;

  // Quadratic curve control points bow outward gently so the paper edge looks rolled, not sharp origami
  const midAX = (pAx + tipX) * 0.5;
  const midAY = (pAy + tipY) * 0.5;
  const midBX = (pBx + tipX) * 0.5;
  const midBY = (pBy + tipY) * 0.5;
  // Normal pointing toward top-left (away from bottom-right corner)
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len; // negative
  const ny = -dx / len; // negative
  const bow = Math.min(8.5, peel * 14);

  const ctrlAX = midAX + nx * bow * 0.55;
  const ctrlAY = midAY + ny * bow * 0.55;
  const ctrlBX = midBX + nx * bow * 0.55;
  const ctrlBY = midBY + ny * bow * 0.55;

  const flapPath =
    peel >= 0.995
      ? ''
      : `M ${pAx.toFixed(2)} ${pAy.toFixed(2)} Q ${ctrlAX.toFixed(2)} ${ctrlAY.toFixed(
          2
        )} ${tipX.toFixed(2)} ${tipY.toFixed(2)} Q ${ctrlBX.toFixed(2)} ${ctrlBY.toFixed(
          2
        )} ${pBx.toFixed(2)} ${pBy.toFixed(2)} Z`;

  // Soft cast shadow band extending slightly toward bottom-right (+nx*-1, +ny*-1) onto underlying next page
  const shadowSpread = 4 + Math.sin(peel * Math.PI) * 9.5;
  const sAx = pAx - nx * shadowSpread;
  const sAy = pAy - ny * shadowSpread;
  const sBx = pBx - nx * shadowSpread;
  const sBy = pBy - ny * shadowSpread;

  const castShadowPath =
    peel >= 0.995
      ? ''
      : `M ${pAx.toFixed(2)} ${pAy.toFixed(2)} L ${pBx.toFixed(2)} ${pBy.toFixed(
          2
        )} L ${sBx.toFixed(2)} ${sBy.toFixed(2)} L ${sAx.toFixed(2)} ${sAy.toFixed(2)} Z`;

  const creasePath =
    peel >= 0.995
      ? ''
      : `M ${pAx.toFixed(2)} ${pAy.toFixed(2)} L ${pBx.toFixed(2)} ${pBy.toFixed(2)}`;

  const shadowOpacity = Number((Math.sin(peel * Math.PI) * 0.44).toFixed(3));
  const creaseHighlightOpacity = Number((Math.sin(peel * Math.PI) * 0.65).toFixed(3));
  const flapClipPath =
    peel >= 0.995
      ? 'polygon(0% 0%, 0% 0%, 0% 0%)'
      : `polygon(${pAx.toFixed(2)}% ${pAy.toFixed(2)}%, ${tipX.toFixed(2)}% ${tipY.toFixed(2)}%, ${pBx.toFixed(2)}% ${pBy.toFixed(2)}%)`;

  // Mirror & rotate back-face slightly along fold angle so curled paper shows faint reversed text
  const foldAngleDeg = Number(((Math.atan2(pBy - pAy, pBx - pAx) * 180) / Math.PI).toFixed(1));
  const shiftX = Number(((tipX - 100) * 0.45).toFixed(1));
  const shiftY = Number(((tipY - 100) * 0.45).toFixed(1));
  const backfaceTransform = `translate3d(${shiftX}%, ${shiftY}%, 0) scaleX(-1) rotate(${(foldAngleDeg + 45) * 0.2}deg)`;

  return {
    peel,
    frontClipPath,
    flapPath,
    castShadowPath,
    creasePath,
    foldBottomX: Number(pAx.toFixed(2)),
    foldRightY: Number(pAy.toFixed(2)),
    tipX: Number(tipX.toFixed(2)),
    tipY: Number(tipY.toFixed(2)),
    shadowOpacity,
    flapClipPath,
    backfaceTransform,
    creaseHighlightOpacity,
  };
}

export interface InteractiveSlideFadeTransform {
  progress: number;
  direction: 'next' | 'prev';
  translateXPx: number;
  opacity: number;
  underlayOpacity: number;
  underlayScale: number;
  underlayBrightness: number;
  edgeShadowOpacity: number;
  shouldCommitFlip: boolean;
}

/**
 * Maps horizontal finger drag in Modern Slide & Depth Parallax mode:
 * - Dragging shifts the top page 1:1 with finger while fading smoothly
 * - Thin dark edge shadow trails along the sliding edge
 * - Underlying next page scales cleanly 0.95 -> 1.0 and brightens 0.86 -> 1.0
 */
export function computeInteractiveSlideFade(
  deltaX: number,
  stageWidth: number
): InteractiveSlideFadeTransform {
  const safeWidth = Math.max(140, stageWidth || 360);
  const direction: 'next' | 'prev' = deltaX <= 0 ? 'next' : 'prev';
  const progress = Math.min(1, Math.max(0, Math.abs(deltaX) / (safeWidth * 0.85)));
  const opacity = Number(Math.max(0.06, 1 - Math.pow(progress, 0.85) * 0.9).toFixed(3));
  const underlayOpacity = Number(Math.min(1, 0.84 + progress * 0.16).toFixed(3));
  const underlayScale = Number((0.95 + progress * 0.05).toFixed(4));
  const underlayBrightness = Number((0.86 + progress * 0.14).toFixed(3));
  const edgeShadowOpacity = Number((Math.sin(progress * Math.PI) * 0.34 + (progress > 0.02 ? 0.08 : 0)).toFixed(3));
  const shouldCommitFlip = progress >= 0.16 || Math.abs(deltaX) >= 44;

  return {
    progress: Number(progress.toFixed(4)),
    direction,
    translateXPx: Number(deltaX.toFixed(2)),
    opacity,
    underlayOpacity,
    underlayScale,
    underlayBrightness,
    edgeShadowOpacity,
    shouldCommitFlip,
  };
}


