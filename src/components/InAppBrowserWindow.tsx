import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  EyeOff,
  Loader2,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { resolveApiUrl } from '../utils/apiClient';
import type { WebCrawlerController } from '../hooks/useWebCrawler';

interface InAppBrowserWindowProps {
  open: boolean;
  initialUrl: string;
  crawler: WebCrawlerController;
  onClose: () => void;
  onBackgroundToLibrary?: () => void;
  onUrlChange?: (url: string) => void;
}

/**
 * Full-screen In-App Native Browser Window opened from "Cộng đồng -> Trình duyệt gốc".
 * Top toolbar strictly contains 3 elevated buttons:
 *   1) "Quay lại" (left)
 *   2) "AI bắt đầu quét" (center)
 *   3) "Chạy ẩn" (right — immediately closes browser and returns user to Library while AI keeps scanning in background)
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
  const [iframeSrc, setIframeSrc] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const clean = initialUrl.trim();
    setLiveUrl(clean);
    setLocalError(null);
    const browsePath = clean
      ? `/api/web/browse?url=${encodeURIComponent(clean)}`
      : '/api/web/browse';
    setIframeSrc(resolveApiUrl(browsePath));
  }, [open, initialUrl]);

  useEffect(() => {
    if (!open) return;
    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as
        | { type?: string; url?: string; title?: string }
        | null
        | undefined;
      if (!payload || payload.type !== 'BOOKHAD_BROWSER_URL') return;
      if (typeof payload.url === 'string') {
        setLiveUrl(payload.url);
        if (payload.url && onUrlChange) {
          onUrlChange(payload.url);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [open, onUrlChange]);

  if (!open) return null;

  const isCrawling = crawler.crawlStatus === 'running';
  const hasCrawlIssue = crawler.crawlStatus === 'issue' && Boolean(crawler.issueMessage);

  const handleToggleAutoScan = () => {
    if (isCrawling) {
      crawler.togglePause();
      return;
    }
    const target = liveUrl.trim() || initialUrl.trim();
    if (!target) {
      setLocalError(
        'Hãy mở một trang truyện trong trình duyệt phía dưới rồi bấm AI bắt đầu quét.'
      );
      return;
    }
    setLocalError(null);
    crawler.startAiAutoScanAndSave(target);
  };

  const handleRunInBackground = () => {
    const target = liveUrl.trim() || initialUrl.trim();
    if (!isCrawling && target) {
      crawler.startAiAutoScanAndSave(target);
    }
    onClose();
    onBackgroundToLibrary?.();
  };

  const windowContent = (
    <div
      className="fixed inset-0 z-50 bg-stone-50 dark:bg-zinc-950 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Trình duyệt gốc trong ứng dụng"
      data-testid="in-app-browser-window"
    >
      {/* Top Bar — strictly 3 buttons: (1) Quay lại, (2) AI bắt đầu quét, (3) Chạy ẩn */}
      <div className="h-14 px-2.5 bg-white dark:bg-zinc-900 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-1.5 shrink-0">
        <button
          type="button"
          data-testid="browser-back-btn"
          onClick={onClose}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-stone-800 dark:text-stone-100 text-[11.5px] font-semibold shadow-xs hover:bg-stone-50 transition-colors shrink-0"
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

      {/* Dismissible (X) issue / paywall / error alert overlay when AI scan hits a blocker */}
      {(localError || hasCrawlIssue) && (
        <div className="px-3 py-2 bg-amber-50 dark:bg-amber-950/80 border-b border-amber-300/80 dark:border-amber-800 flex items-start justify-between gap-2 shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0 text-[11px] text-amber-950 dark:text-amber-100 leading-snug">
              <p className="font-bold">
                {hasCrawlIssue ? 'Trình AI quét tạm dừng để bạn kiểm tra' : 'Thông báo trình duyệt AI'}
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

      {/* Embedded Web Viewport */}
      <iframe
        title="Trình duyệt web trong BOOKHAD"
        src={iframeSrc}
        className="w-full flex-1 border-0 bg-white"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
      />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(windowContent, document.body) : windowContent;
}
