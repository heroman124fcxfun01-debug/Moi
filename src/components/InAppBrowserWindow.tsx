import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  EyeOff,
  Globe,
  Home,
  Loader2,
  RotateCw,
  Search,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { isNativeAndroidApp, resolveApiUrl } from '../utils/apiClient';
import { buildNativeBrowserHref } from '../utils/webCrawlerEngine';
import type { WebCrawlerController } from '../hooks/useWebCrawler';

interface InAppBrowserWindowProps {
  open: boolean;
  initialUrl: string;
  crawler: WebCrawlerController;
  onClose: () => void;
  onBackgroundToLibrary?: () => void;
  onUrlChange?: (url: string) => void;
}

interface NativeBrowserBridge {
  openEmbeddedWebView?: (url: string, topPx: number, bottomPx: number) => void;
  navigateEmbeddedWebView?: (url: string) => void;
  embeddedWebViewGoBack?: () => void;
  embeddedWebViewGoForward?: () => void;
  embeddedWebViewReload?: () => void;
  closeEmbeddedWebView?: () => void;
}

function getNativeBrowserBridge(): NativeBrowserBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { BookhadNative?: NativeBrowserBridge }).BookhadNative;
  return bridge && typeof bridge.openEmbeddedWebView === 'function' ? bridge : null;
}

function normalizeBrowserInput(raw: string): string {
  const val = raw.trim();
  if (!val) return '';
  if (val.startsWith('/') || /^https?:\/\//i.test(val)) return val;
  if (val.includes('.') && !val.includes(' ')) return `https://${val}`;
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(val)}`;
}

/**
 * Framed WebView-Style In-App Browser Window opened from "Cộng đồng -> Trình duyệt gốc".
 *
 * Layout:
 *  - Floating rounded WebView window card over dimmed backdrop
 *  - Top action bar: (1) Quay lại, (2) AI bắt đầu quét, (3) Chạy ẩn
 *  - Native-style browser navigation bar: Back / Forward / Reload / Home + URL/Search bar + Open External
 *  - Center viewport: Live embedded browser (real native Android WebView on APK; proxied interactive
 *    browser iframe on Web with automatic postMessage URL sync so AI crawls the exact visible chapter)
 */
export function InAppBrowserWindow({
  open,
  initialUrl,
  crawler,
  onClose,
  onBackgroundToLibrary,
  onUrlChange,
}: InAppBrowserWindowProps) {
  const [liveUrl, setLiveUrl] = useState(initialUrl.trim());
  const [addressInput, setAddressInput] = useState(initialUrl.trim());
  const [pageTitle, setPageTitle] = useState('Trình duyệt WebView');
  const [iframeSrc, setIframeSrc] = useState('');
  const [isFrameLoading, setIsFrameLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [historyStack, setHistoryStack] = useState<string[]>(['']);
  const [historyIndex, setHistoryIndex] = useState(0);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const frameKeyRef = useRef(0);
  const [reloadNonce, setReloadNonce] = useState(0);

  const buildBrowseSrc = useCallback((target: string) => {
    const clean = target.trim();
    const browsePath = clean
      ? `/api/web/browse?url=${encodeURIComponent(clean)}`
      : '/api/web/browse';
    return resolveApiUrl(browsePath);
  }, []);

  const navigateTo = useCallback(
    (rawTarget: string, pushHistory = true) => {
      const normalized = normalizeBrowserInput(rawTarget);
      setLiveUrl(normalized);
      setAddressInput(normalized);
      setLocalError(null);
      setIsFrameLoading(true);

      const nativeBridge = getNativeBrowserBridge();
      if (nativeBridge && viewportRef.current) {
        const rect = viewportRef.current.getBoundingClientRect();
        const targetForNative = normalized || 'https://www.google.com/';
        nativeBridge.openEmbeddedWebView?.(
          targetForNative,
          Math.round(rect.top),
          Math.max(0, Math.round(window.innerHeight - rect.bottom))
        );
      } else {
        setIframeSrc(buildBrowseSrc(normalized));
      }

      if (normalized && onUrlChange) {
        onUrlChange(normalized);
      }

      if (pushHistory) {
        setHistoryStack((prev) => {
          const next = prev.slice(0, historyIndex + 1);
          if (next[next.length - 1] !== normalized) {
            next.push(normalized);
          }
          setHistoryIndex(next.length - 1);
          return next;
        });
      }
    },
    [buildBrowseSrc, historyIndex, onUrlChange]
  );

  useEffect(() => {
    if (!open) {
      getNativeBrowserBridge()?.closeEmbeddedWebView?.();
      return;
    }
    const clean = normalizeBrowserInput(initialUrl.trim());
    setLiveUrl(clean);
    setAddressInput(clean);
    setPageTitle(clean ? 'Đang tải trang...' : 'Trình duyệt gốc BOOKHAD');
    setLocalError(null);
    setHistoryStack([clean]);
    setHistoryIndex(0);
    setIsFrameLoading(true);

    const nativeBridge = getNativeBrowserBridge();
    if (nativeBridge) {
      const timer = window.setTimeout(() => {
        const rect = viewportRef.current?.getBoundingClientRect();
        nativeBridge.openEmbeddedWebView?.(
          clean || 'https://www.google.com/',
          Math.round(rect?.top ?? 116),
          Math.max(0, Math.round(window.innerHeight - (rect?.bottom ?? window.innerHeight)))
        );
      }, 60);
      return () => {
        window.clearTimeout(timer);
        nativeBridge.closeEmbeddedWebView?.();
      };
    }

    setIframeSrc(buildBrowseSrc(clean));
    return undefined;
  }, [open, initialUrl, buildBrowseSrc]);

  useEffect(() => {
    if (!open) return;

    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as
        | { type?: string; url?: string; title?: string }
        | null
        | undefined;
      if (!payload || payload.type !== 'BOOKHAD_BROWSER_URL') return;
      if (typeof payload.url === 'string') {
        const nextUrl = payload.url;
        setLiveUrl(nextUrl);
        setAddressInput(nextUrl);
        setIsFrameLoading(false);
        if (payload.title) setPageTitle(payload.title);
        if (nextUrl && onUrlChange) {
          onUrlChange(nextUrl);
        }
        setHistoryStack((prev) => {
          if (prev[prev.length - 1] === nextUrl) return prev;
          const updated = [...prev, nextUrl];
          setHistoryIndex(updated.length - 1);
          return updated;
        });
      }
    };

    const handleNativeUrl = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string; title?: string }>).detail;
      if (!detail || typeof detail.url !== 'string') return;
      setLiveUrl(detail.url);
      setAddressInput(detail.url);
      if (detail.title) setPageTitle(detail.title);
      setIsFrameLoading(false);
      if (detail.url && onUrlChange) onUrlChange(detail.url);
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('bookhad-browser-url', handleNativeUrl);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('bookhad-browser-url', handleNativeUrl);
    };
  }, [open, onUrlChange]);

  if (!open) return null;

  const isCrawling = crawler.crawlStatus === 'running';
  const hasCrawlIssue = crawler.crawlStatus === 'issue' && Boolean(crawler.issueMessage);
  const usingNativeWebView = Boolean(getNativeBrowserBridge());

  const canGoBack = usingNativeWebView || historyIndex > 0;
  const canGoForward = usingNativeWebView || historyIndex < historyStack.length - 1;

  const handleGoBack = () => {
    const nativeBridge = getNativeBrowserBridge();
    if (nativeBridge) {
      nativeBridge.embeddedWebViewGoBack?.();
      return;
    }
    if (historyIndex <= 0) return;
    const prevIdx = historyIndex - 1;
    const target = historyStack[prevIdx] ?? '';
    setHistoryIndex(prevIdx);
    setLiveUrl(target);
    setAddressInput(target);
    setIsFrameLoading(true);
    setIframeSrc(buildBrowseSrc(target));
  };

  const handleGoForward = () => {
    const nativeBridge = getNativeBrowserBridge();
    if (nativeBridge) {
      nativeBridge.embeddedWebViewGoForward?.();
      return;
    }
    if (historyIndex >= historyStack.length - 1) return;
    const nextIdx = historyIndex + 1;
    const target = historyStack[nextIdx] ?? '';
    setHistoryIndex(nextIdx);
    setLiveUrl(target);
    setAddressInput(target);
    setIsFrameLoading(true);
    setIframeSrc(buildBrowseSrc(target));
  };

  const handleReload = () => {
    const nativeBridge = getNativeBrowserBridge();
    if (nativeBridge) {
      nativeBridge.embeddedWebViewReload?.();
      return;
    }
    setIsFrameLoading(true);
    frameKeyRef.current += 1;
    setReloadNonce(frameKeyRef.current);
  };

  const handleHome = () => {
    navigateTo('', true);
  };

  const handleAddressSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigateTo(addressInput, true);
  };

  const handleToggleAutoScan = () => {
    if (isCrawling) {
      crawler.togglePause();
      return;
    }
    const target = liveUrl.trim() || addressInput.trim() || initialUrl.trim();
    if (!target) {
      setLocalError(
        'Hãy mở một trang truyện trong trình duyệt ở giữa rồi bấm AI bắt đầu quét.'
      );
      return;
    }
    setLocalError(null);
    crawler.startAiAutoScanAndSave(normalizeBrowserInput(target));
  };

  const handleRunInBackground = () => {
    const target = liveUrl.trim() || addressInput.trim() || initialUrl.trim();
    if (!isCrawling && target) {
      crawler.startAiAutoScanAndSave(normalizeBrowserInput(target));
    }
    getNativeBrowserBridge()?.closeEmbeddedWebView?.();
    onClose();
    onBackgroundToLibrary?.();
  };

  const handleClose = () => {
    getNativeBrowserBridge()?.closeEmbeddedWebView?.();
    onClose();
  };

  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const externalHref = buildNativeBrowserHref(
    liveUrl || addressInput || 'https://www.google.com/',
    isNativeAndroidApp(),
    currentOrigin
  );

  const windowContent = (
    <div
      className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[3px] flex items-center justify-center p-1.5 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cửa sổ trình duyệt WebView"
      data-testid="in-app-browser-window"
    >
      {/* Framed WebView Modal Window */}
      <div className="w-full h-full max-w-5xl max-h-[96dvh] sm:max-h-[90dvh] rounded-[22px] sm:rounded-[26px] border border-stone-300/80 dark:border-zinc-700/80 bg-white dark:bg-zinc-900 shadow-2xl flex flex-col overflow-hidden">
        {/* Row 1: Top Action Bar (Quay lại · AI bắt đầu quét · Chạy ẩn) */}
        <div className="px-2.5 sm:px-3.5 py-2 bg-stone-50/95 dark:bg-zinc-900 border-b border-stone-200/80 dark:border-zinc-800 flex items-center justify-between gap-1.5 shrink-0">
          <button
            type="button"
            data-testid="browser-back-btn"
            onClick={handleClose}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-800 dark:text-stone-100 text-[11.5px] font-semibold shadow-xs hover:bg-stone-100 transition-colors shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span>Quay lại</span>
          </button>

          <button
            type="button"
            data-testid="browser-ai-scan-btn"
            onClick={handleToggleAutoScan}
            className={`inline-flex items-center justify-center gap-1 px-3.5 py-1.5 rounded-full text-[11.5px] font-semibold shadow-xs transition-all min-w-0 truncate ${
              isCrawling
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-amber-800 hover:bg-amber-900 text-white'
            }`}
          >
            {isCrawling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="truncate">Đang quét ({crawler.scrapedList.length})</span>
                <Square className="w-2.5 h-2.5 fill-current shrink-0" />
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">AI bắt đầu quét</span>
              </>
            )}
          </button>

          <button
            type="button"
            data-testid="browser-background-btn"
            onClick={handleRunInBackground}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-amber-700/35 bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 text-[11.5px] font-semibold shadow-xs hover:bg-amber-100/80 transition-colors shrink-0"
          >
            <EyeOff className="w-3.5 h-3.5 shrink-0" />
            <span>Chạy ẩn</span>
          </button>
        </div>

        {/* Row 2: WebView Native-Style Browser Navigation & Address Bar */}
        <div className="px-2 sm:px-3 py-1.5 bg-white dark:bg-zinc-900 border-b border-stone-200/80 dark:border-zinc-800 flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={handleGoBack}
              disabled={!canGoBack}
              aria-label="Trang trước"
              className="w-7 h-7 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-35"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleGoForward}
              disabled={!canGoForward}
              aria-label="Trang tiếp"
              className="w-7 h-7 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-35"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleReload}
              aria-label="Tải lại trang"
              className="w-7 h-7 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-zinc-800"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isFrameLoading ? 'animate-spin text-amber-700' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleHome}
              aria-label="Trang chủ trình duyệt"
              className="w-7 h-7 rounded-full flex items-center justify-center text-stone-700 dark:text-stone-200 hover:bg-stone-100 dark:hover:bg-zinc-800"
            >
              <Home className="w-3.5 h-3.5" />
            </button>
          </div>

          <form onSubmit={handleAddressSubmit} className="flex-1 min-w-0 flex items-center relative">
            <Globe className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 pointer-events-none" />
            <input
              type="text"
              data-testid="webview-address-input"
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              placeholder="Nhập địa chỉ web hoặc tìm tên truyện..."
              aria-label="Thanh địa chỉ trình duyệt WebView"
              className="w-full min-w-0 pl-8 pr-8 py-1.5 rounded-full bg-stone-100 dark:bg-zinc-800 border border-stone-200/80 dark:border-zinc-700 text-[11.5px] text-stone-900 dark:text-stone-100 focus:outline-none focus:border-amber-700"
            />
            <button
              type="submit"
              aria-label="Đi tới địa chỉ"
              className="absolute right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-stone-500 hover:text-amber-800 dark:hover:text-amber-400"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </form>

          <a
            href={externalHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Mở bằng trình duyệt máy"
            aria-label="Mở bằng trình duyệt máy"
            className="w-7 h-7 rounded-full flex items-center justify-center text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-zinc-800 shrink-0"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Dismissible (X) issue / paywall / error alert overlay */}
        {(localError || hasCrawlIssue) && (
          <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/80 border-b border-amber-300/80 dark:border-amber-800 flex items-start justify-between gap-2 shrink-0">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="min-w-0 text-[11px] text-amber-950 dark:text-amber-100 leading-snug">
                <p className="font-bold">
                  {hasCrawlIssue ? 'Trình AI quét tạm dừng để bạn kiểm tra' : 'Thông báo trình duyệt WebView'}
                </p>
                <p className="opacity-90">{crawler.issueMessage || localError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setLocalError(null);
                crawler.dismissIssueAlert();
              }}
              aria-label="Đóng thông báo"
              className="p-1 rounded-lg text-amber-800 dark:text-amber-200 hover:bg-amber-200/60 shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Center Embedded Browser Content Area */}
        <div
          ref={viewportRef}
          data-testid="webview-center-viewport"
          className="relative flex-1 min-h-0 w-full bg-white dark:bg-zinc-950 flex flex-col overflow-hidden"
        >
          {isFrameLoading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-amber-100 dark:bg-amber-950 overflow-hidden z-10">
              <div className="h-full w-1/2 bg-amber-700 animate-pulse" />
            </div>
          )}

          {usingNativeWebView ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-stone-500">
              <Globe className="w-6 h-6 text-amber-700 mb-2 animate-pulse" />
              <p className="font-semibold text-stone-800 dark:text-stone-200">
                Đang hiển thị trình duyệt gốc Android WebView ở giữa...
              </p>
              <p className="mt-1 opacity-80 truncate max-w-full">{liveUrl || pageTitle}</p>
            </div>
          ) : iframeSrc ? (
            <iframe
              key={`${iframeSrc}-${reloadNonce}`}
              data-testid="webview-browser-frame"
              title={pageTitle || 'Trình duyệt web trong BOOKHAD'}
              src={iframeSrc}
              onLoad={() => setIsFrameLoading(false)}
              className="w-full flex-1 border-0 bg-white"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
            />
          ) : null}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(windowContent, document.body) : windowContent;
}
