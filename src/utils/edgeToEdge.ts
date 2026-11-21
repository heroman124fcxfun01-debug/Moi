/**
 * Edge-to-Edge System Bar & Reader Tap Zone Utilities.
 * - Computes exact relative luminance so status bar icons auto-invert (black on light paper, white on dark/night paper).
 * - Syncs <meta name="theme-color">, html/body background, native Android bridge (BookhadNative),
 *   and Capacitor StatusBar plugin so background fills 100% behind status & navigation bars.
 */

export interface SystemBarAppearance {
  backgroundHex: string;
  isDark?: boolean;
}

export interface ReaderTapZoneResult {
  zone: 'prev' | 'center-menu' | 'next';
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const clean = (hex || '').trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return { r, g, b };
  }
  return null;
}

/**
 * Returns true if the given hex background is perceptually light
 * (meaning system status bar clock/battery icons should be rendered in BLACK).
 */
export function isLightBackgroundHex(hex: string, fallbackDark = false): boolean {
  const rgb = parseHexColor(hex);
  if (!rgb) return !fallbackDark;
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
  return lum >= 0.42;
}

/**
 * Evaluates horizontal tap ratio (0..1) inside the Reader canvas:
 * - Left 30% (< 0.30) -> previous page
 * - Center 40% (0.30 .. 0.70) -> toggle Clean Reader Menu chrome
 * - Right 30% (> 0.70) -> next page
 */
export function evaluateReaderTapZone(xRatio: number): ReaderTapZoneResult {
  if (xRatio < 0.3) return { zone: 'prev' };
  if (xRatio > 0.7) return { zone: 'next' };
  return { zone: 'center-menu' };
}

/**
 * Determines whether the floating "Về trang đang nghe" pill button should appear.
 */
export function shouldShowReturnToListeningPill(params: {
  isListeningActive: boolean;
  listeningChapterIndex: number | null;
  listeningPageIndex: number | null;
  currentChapterIndex: number;
  currentPageIndex: number;
  isPaginatedMode: boolean;
}): boolean {
  if (!params.isListeningActive) return false;
  if (params.listeningChapterIndex === null) return false;
  if (params.listeningChapterIndex !== params.currentChapterIndex) return true;
  if (!params.isPaginatedMode) return false;
  if (params.listeningPageIndex === null) return false;
  return params.listeningPageIndex !== params.currentPageIndex;
}

interface NativeAndroidBridge {
  setEdgeToEdgeSystemBars?: (backgroundHex: string, isLightStatusBar: boolean) => void;
}

interface CapacitorStatusBarPlugin {
  setOverlaysWebView?: (opts: { overlay: boolean }) => Promise<void>;
  setBackgroundColor?: (opts: { color: string }) => Promise<void>;
  setStyle?: (opts: { style: 'DARK' | 'LIGHT' }) => Promise<void>;
}

/**
 * Synchronizes Edge-to-Edge status bar color and icon contrast across Web/PWA,
 * Capacitor Android StatusBar plugin, and custom MainActivity BookhadNative bridge.
 */
export function syncSystemBarAppearance(appearance: SystemBarAppearance): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const hex = appearance.backgroundHex || '#F7F4EE';
  const isLight =
    typeof appearance.isDark === 'boolean'
      ? !appearance.isDark && isLightBackgroundHex(hex, appearance.isDark)
      : isLightBackgroundHex(hex, false);

  // 1. Update <meta name="theme-color"> for Android Chrome / PWA / WebView status bar blend
  let themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeMeta) {
    themeMeta = document.createElement('meta');
    themeMeta.name = 'theme-color';
    document.head.appendChild(themeMeta);
  }
  themeMeta.setAttribute('content', hex);

  // 2. Sync root html/body background so overscroll & safe-area-inset-top never show a black bar
  document.documentElement.style.setProperty('--edge-bar-bg', hex);
  document.documentElement.style.backgroundColor = hex;
  document.documentElement.dataset.edgeLightBar = isLight ? 'true' : 'false';

  // 3. Call native Android MainActivity bridge if present
  const win = window as unknown as {
    BookhadNative?: NativeAndroidBridge;
    Capacitor?: { Plugins?: { StatusBar?: CapacitorStatusBarPlugin } };
  };
  try {
    win.BookhadNative?.setEdgeToEdgeSystemBars?.(hex, isLight);
  } catch {
    // Ignore bridge unavailability in browser
  }

  // 4. Call Capacitor StatusBar plugin if bundled in APK
  const statusBar = win.Capacitor?.Plugins?.StatusBar;
  if (statusBar) {
    statusBar.setOverlaysWebView?.({ overlay: true }).catch(() => {});
    statusBar.setBackgroundColor?.({ color: '#00000000' }).catch(() => {});
    // In Capacitor StatusBar: Style.LIGHT = dark text/icons for light bg, Style.DARK = white icons for dark bg
    statusBar.setStyle?.({ style: isLight ? 'LIGHT' : 'DARK' }).catch(() => {});
  }
}
