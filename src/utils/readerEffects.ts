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
