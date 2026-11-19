import type { AppAccentId } from '../types/book';

export interface AppColorPalette {
  id: Exclude<AppAccentId, 'custom'>;
  name: string;
  accentLight: string;
  accentDark: string;
  accentRgb: string;
  bgLight: string;
  bgDark: string;
  swatch: string;
}

export const APP_COLOR_PALETTES: AppColorPalette[] = [
  {
    id: 'amber',
    name: 'Hổ phách cổ',
    accentLight: '#92400E',
    accentDark: '#F59E0B',
    accentRgb: '146, 64, 14',
    bgLight: '#F7F4EE',
    bgDark: '#121316',
    swatch: '#B45309',
  },
  {
    id: 'ocean',
    name: 'Đại dương',
    accentLight: '#0369A1',
    accentDark: '#38BDF8',
    accentRgb: '3, 105, 161',
    bgLight: '#F1F6FA',
    bgDark: '#0D131A',
    swatch: '#0284C7',
  },
  {
    id: 'forest',
    name: 'Rừng thông',
    accentLight: '#166534',
    accentDark: '#4ADE80',
    accentRgb: '22, 101, 52',
    bgLight: '#F2F7F3',
    bgDark: '#0E1511',
    swatch: '#15803D',
  },
  {
    id: 'indigo',
    name: 'Chàm đêm',
    accentLight: '#4338CA',
    accentDark: '#818CF8',
    accentRgb: '67, 56, 202',
    bgLight: '#F3F4FA',
    bgDark: '#10111B',
    swatch: '#4F46E5',
  },
  {
    id: 'rose',
    name: 'San hô',
    accentLight: '#BE123C',
    accentDark: '#FB7185',
    accentRgb: '190, 18, 60',
    bgLight: '#FAF2F4',
    bgDark: '#181014',
    swatch: '#E11D48',
  },
  {
    id: 'teal',
    name: 'Ngọc bích',
    accentLight: '#0F766E',
    accentDark: '#2DD4BF',
    accentRgb: '15, 118, 110',
    bgLight: '#F0F7F6',
    bgDark: '#0D1616',
    swatch: '#0D9488',
  },
  {
    id: 'slate',
    name: 'Mực tối giản',
    accentLight: '#334155',
    accentDark: '#CBD5E1',
    accentRgb: '51, 65, 85',
    bgLight: '#F4F5F7',
    bgDark: '#111317',
    swatch: '#475569',
  },
];

export interface AppWallpaperPreset {
  id:
    | 'none'
    | 'ink-mountain-river'
    | 'ink-autumn-river'
    | 'ink-jade-peaks'
    | 'ink-moonlit-river'
    | 'misty-pine'
    | 'starry-night'
    | 'sunset-silk'
    | 'ocean-clouds';
  name: string;
  previewCss: string;
  dataUrl: string | null;
}

function encodeSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s+/g, ' ').trim())}`;
}

export const APP_WALLPAPER_PRESETS: AppWallpaperPreset[] = [
  {
    id: 'none',
    name: 'Không ảnh nền',
    previewCss: 'linear-gradient(135deg, #f5f2eb 0%, #e7e1d5 100%)',
    dataUrl: null,
  },
  {
    id: 'ink-mountain-river',
    name: 'Thủy mặc sông núi',
    previewCss: 'linear-gradient(160deg, #f2ede3 0%, #a8aba6 52%, #2c3135 100%)',
    dataUrl: '/wallpapers/ink-mountain-river.jpg',
  },
  {
    id: 'ink-autumn-river',
    name: 'Sơn thủy thu vàng',
    previewCss: 'linear-gradient(160deg, #f3e8d7 0%, #c49b76 52%, #4a4643 100%)',
    dataUrl: '/wallpapers/ink-autumn-river.jpg',
  },
  {
    id: 'ink-jade-peaks',
    name: 'Thanh sơn bích thủy',
    previewCss: 'linear-gradient(160deg, #e7efe9 0%, #6d9c92 52%, #234946 100%)',
    dataUrl: '/wallpapers/ink-jade-peaks.jpg',
  },
  {
    id: 'ink-moonlit-river',
    name: 'Trăng rọi giang sơn',
    previewCss: 'linear-gradient(160deg, #1b2434 0%, #37465d 52%, #0e131d 100%)',
    dataUrl: '/wallpapers/ink-moonlit-river.jpg',
  },
  {
    id: 'misty-pine',
    name: 'Sương rừng',
    previewCss: 'linear-gradient(160deg, #dce8df 0%, #7da089 55%, #2a4538 100%)',
    dataUrl: encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0%" stop-color="#e5efe7"/>
            <stop offset="55%" stop-color="#a6c2b0"/>
            <stop offset="100%" stop-color="#2c483a"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="1600" fill="url(#sky)"/>
        <circle cx="920" cy="280" r="140" fill="#fffdf6" opacity="0.45"/>
        <path d="M0 980 Q300 840 620 960 T1200 900 L1200 1600 L0 1600 Z" fill="#4f7460" opacity="0.45"/>
        <path d="M0 1160 Q360 1020 740 1150 T1200 1090 L1200 1600 L0 1600 Z" fill="#2d4d3e" opacity="0.65"/>
        <path d="M0 1350 Q420 1240 820 1360 T1200 1300 L1200 1600 L0 1600 Z" fill="#1b3228" opacity="0.85"/>
      </svg>
    `),
  },
  {
    id: 'starry-night',
    name: 'Đêm sao',
    previewCss: 'linear-gradient(160deg, #0b1224 0%, #1d2d52 55%, #374974 100%)',
    dataUrl: encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="night" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stop-color="#090f1e"/>
            <stop offset="60%" stop-color="#1a294d"/>
            <stop offset="100%" stop-color="#314168"/>
          </linearGradient>
          <radialGradient id="glow" cx="75%" cy="22%" r="40%">
            <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.28"/>
            <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="1200" height="1600" fill="url(#night)"/>
        <rect width="1200" height="1600" fill="url(#glow)"/>
        <g fill="#f8fafc" opacity="0.75">
          <circle cx="160" cy="180" r="3"/><circle cx="320" cy="110" r="2"/><circle cx="480" cy="240" r="2.5"/>
          <circle cx="710" cy="140" r="3"/><circle cx="880" cy="210" r="2"/><circle cx="1040" cy="120" r="2.5"/>
          <circle cx="230" cy="420" r="2"/><circle cx="620" cy="390" r="3"/><circle cx="960" cy="460" r="2"/>
          <circle cx="410" cy="610" r="2.5"/><circle cx="790" cy="560" r="2"/><circle cx="1090" cy="640" r="3"/>
        </g>
        <path d="M0 1240 Q320 1130 680 1250 T1200 1190 L1200 1600 L0 1600 Z" fill="#0d172e" opacity="0.78"/>
      </svg>
    `),
  },
  {
    id: 'sunset-silk',
    name: 'Lụa hoàng hôn',
    previewCss: 'linear-gradient(155deg, #fbe8d3 0%, #e7b59a 52%, #a86452 100%)',
    dataUrl: encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="silk" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#fcf0e1"/>
            <stop offset="48%" stop-color="#e9bea4"/>
            <stop offset="100%" stop-color="#9e5a49"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="1600" fill="url(#silk)"/>
        <circle cx="860" cy="340" r="240" fill="#fff7eb" opacity="0.35"/>
        <path d="M0 940 C340 820 760 1120 1200 880 L1200 1600 L0 1600 Z" fill="#c9806b" opacity="0.35"/>
        <path d="M0 1220 C420 1090 780 1340 1200 1160 L1200 1600 L0 1600 Z" fill="#7d4134" opacity="0.42"/>
      </svg>
    `),
  },
  {
    id: 'ocean-clouds',
    name: 'Mây đại dương',
    previewCss: 'linear-gradient(160deg, #e0f2fe 0%, #7dd3fc 52%, #0c4a6e 100%)',
    dataUrl: encodeSvgDataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1600" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="sea" x1="0" y1="0" x2="0.2" y2="1">
            <stop offset="0%" stop-color="#e6f4fc"/>
            <stop offset="52%" stop-color="#87c5e8"/>
            <stop offset="100%" stop-color="#134e6f"/>
          </linearGradient>
        </defs>
        <rect width="1200" height="1600" fill="url(#sea)"/>
        <ellipse cx="320" cy="360" rx="280" ry="70" fill="#ffffff" opacity="0.4"/>
        <ellipse cx="860" cy="480" rx="340" ry="85" fill="#ffffff" opacity="0.32"/>
        <path d="M0 1120 Q360 1050 720 1130 T1200 1090 L1200 1600 L0 1600 Z" fill="#0c4a6e" opacity="0.5"/>
      </svg>
    `),
  },
];

export function hexToRgbTuple(hex: string): [number, number, number] {
  const cleaned = (hex || '').trim().replace(/^#/, '');
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return [146, 64, 14];
  }
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('')
  );
}

function mixHex(hexA: string, hexB: string, ratioB: number): string {
  const [r1, g1, b1] = hexToRgbTuple(hexA);
  const [r2, g2, b2] = hexToRgbTuple(hexB);
  const t = Math.max(0, Math.min(1, ratioB));
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export interface ResolvedAppThemeVars {
  accentLight: string;
  accentDark: string;
  accentRgb: string;
  bgLight: string;
  bgDark: string;
  isCustomOrAlternate: boolean;
}

export function resolveAppThemeVars(
  accentId: AppAccentId = 'amber',
  customHex = '#0369A1'
): ResolvedAppThemeVars {
  if (accentId === 'custom') {
    const [r, g, b] = hexToRgbTuple(customHex);
    const normalized = rgbToHex(r, g, b);
    const accentDark = mixHex(normalized, '#FFFFFF', 0.35);
    const bgLight = mixHex('#FAF9F7', normalized, 0.055);
    const bgDark = mixHex('#111317', normalized, 0.08);
    return {
      accentLight: normalized,
      accentDark,
      accentRgb: `${r}, ${g}, ${b}`,
      bgLight,
      bgDark,
      isCustomOrAlternate: true,
    };
  }
  const preset = APP_COLOR_PALETTES.find((p) => p.id === accentId) || APP_COLOR_PALETTES[0];
  return {
    accentLight: preset.accentLight,
    accentDark: preset.accentDark,
    accentRgb: preset.accentRgb,
    bgLight: preset.bgLight,
    bgDark: preset.bgDark,
    isCustomOrAlternate: preset.id !== 'amber',
  };
}

/**
 * Determines whether the app shell wallpaper should be displayed.
 * CRITICAL RULE: Wallpaper is NEVER shown while reading a book (`activeTab === 'reader'`).
 */
export function shouldRenderAppWallpaper(
  activeTab: 'library' | 'reader' | 'web' | 'studio' | 'settings',
  wallpaperUrl: string | null | undefined
): boolean {
  if (activeTab === 'reader') return false;
  return Boolean(wallpaperUrl && wallpaperUrl.trim().length > 0);
}

export function resolveActiveWallpaperUrl(
  presetId: string | undefined,
  customDataUrl: string | null | undefined
): string | null {
  if (!presetId || presetId === 'none') return null;
  if (presetId === 'custom') {
    return customDataUrl && customDataUrl.trim().length > 0 ? customDataUrl : null;
  }
  const preset = APP_WALLPAPER_PRESETS.find((p) => p.id === presetId);
  return preset?.dataUrl ?? null;
}

/**
 * Compresses an uploaded image file on-device using Canvas so large phone photos
 * fit smoothly into IndexedDB and render smoothly at 60fps on mobile screens.
 */
export async function compressWallpaperImageFile(
  file: File,
  maxEdge = 1440,
  quality = 0.82
): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh nền từ thiết bị.'));
    reader.readAsDataURL(file);
  });

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return rawDataUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * scale));
        const height = Math.max(1, Math.round((img.height || 1) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed.length < rawDataUrl.length ? compressed : rawDataUrl);
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}
