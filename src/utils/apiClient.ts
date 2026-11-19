const API_BASE_STORAGE_KEY = 'laziread_api_base_v1';

declare global {
  interface Window {
    Capacitor?: {
      isNativePlatform?: () => boolean;
      getPlatform?: () => string;
    };
  }
}

export function isNativeAndroidApp(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

export function getStoredApiBase(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (window.localStorage.getItem(API_BASE_STORAGE_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function setStoredApiBase(url: string): string {
  const normalized = url.trim().replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(API_BASE_STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(API_BASE_STORAGE_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }
  return normalized;
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  const stored = getStoredApiBase();
  if (stored && /^https?:\/\//i.test(stored)) {
    return `${stored}${cleanPath}`;
  }

  const envBase = (
    (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
      ?.VITE_API_BASE_URL || ''
  )
    .trim()
    .replace(/\/+$/, '');

  if (isNativeAndroidApp() && envBase) {
    return `${envBase}${cleanPath}`;
  }

  return cleanPath;
}
