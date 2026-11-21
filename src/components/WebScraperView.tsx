import React, { useEffect, useRef, useState } from 'react';
import {
  Globe,
  Play,
  Pause,
  Square,
  Download,
  BookPlus,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Minimize2,
  Maximize2,
  AlertTriangle,
  FolderOpen,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
  ClipboardPaste,
  X,
  Youtube,
  Settings,
  ListVideo,
  Clock,
} from 'lucide-react';
import type { Book, BookReadingStyle } from '../types/book';
import type { WebCrawlerController } from '../hooks/useWebCrawler';
import { isNativeAndroidApp, resolveApiUrl } from '../utils/apiClient';
import { buildNativeBrowserHref, type WebIssueReason } from '../utils/webCrawlerEngine';
import { GlassSelect } from './GlassSelect';
import { InAppBrowserWindow } from './InAppBrowserWindow';
import { IosSheet } from './IosSheet';
import { TwoTapDeleteButton } from './TwoTapDeleteButton';

interface WebScraperViewProps {
  crawler: WebCrawlerController;
  onAddBook?: (book: Book, openImmediately?: boolean) => Promise<void>;
  onEnsureYoutubeCollection?: (bookId: string) => Promise<void>;
  onBackgroundToLibrary?: () => void;
}

const YT_SCHEDULE_STORAGE_KEY = 'bookhad_yt_playlist_schedule_v1';

interface YtScheduleEntry {
  url: string;
  intervalHours: number;
  lastScannedAt: number;
  nextScanAt: number;
  scannedVideoIds: string[];
}

function formatTimerMMSS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

const ISSUE_TITLES: Record<WebIssueReason, string> = {
  paywall: 'Trang web yêu cầu đóng phí / tài khoản VIP',
  login: 'Trang web yêu cầu đăng nhập tài khoản',
  captcha: 'Trang web yêu cầu xác minh Captcha / Chống bot',
  empty: 'Không đọc được nội dung chương trên trang này',
  error: 'Không thể kết nối hoặc phân tích trang web',
  duplicate_loop: 'Phát hiện lặp lại trang đã quét',
  end_of_book: 'Đã đến chương cuối cùng',
};

const STYLE_OPTIONS: Array<{ value: BookReadingStyle; label: string }> = [
  { value: 'novel', label: 'Tiểu thuyết' },
  { value: 'selfhelp', label: 'Văn phong học tập' },
  { value: 'essay', label: 'Tản văn' },
  { value: 'research', label: 'Nghiên cứu' },
];

export const WebScraperView: React.FC<WebScraperViewProps> = ({
  crawler,
  onAddBook,
  onEnsureYoutubeCollection,
  onBackgroundToLibrary,
}) => {
  const {
    urlInput,
    setUrlInput,
    maxPages,
    setMaxPages,
    autoSaveAndExportEpub,
    setAutoSaveAndExportEpub,
    currentPage,
    scrapedList,
    setScrapedList,
    crawlStatus,
    isMinimized,
    setIsMinimized,
    isFetching,
    statusMessage,
    issueMessage,
    issueReason,
    activeScanStepLabel,
    compiledTitle,
    setCompiledTitle,
    compiledAuthor,
    setCompiledAuthor,
    compiledCollection,
    setCompiledCollection,
    compiledStyle,
    setCompiledStyle,
    openUrlDirectly,
    startAiAutoScanAndSave,
    resumeAfterIssue,
    dismissIssueAlert,
    togglePause,
    stopAndResetStatus,
    saveScrapedToLibrary,
    exportScrapedEpub,
  } = crawler;

  const [copiedLink, setCopiedLink] = useState(false);
  const [pasteNotice, setPasteNotice] = useState('');
  const [showAiHelp, setShowAiHelp] = useState(false);
  const [isBrowserWindowOpen, setIsBrowserWindowOpen] = useState(false);

  // YouTube Transcript-to-EPUB Scanner State (Store-Compliant Captions Only)
  const [ytUrl, setYtUrl] = useState('');
  const [ytModalMode, setYtModalMode] = useState<'single' | 'playlist' | null>(null);
  const [ytScanning, setYtScanning] = useState(false);
  const [ytElapsedSec, setYtElapsedSec] = useState(0);
  const [ytEstimatedTotalSec, setYtEstimatedTotalSec] = useState(35);
  const [ytProgressLabel, setYtProgressLabel] = useState('');
  const [ytNotice, setYtNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [ytPlaylistPreview, setYtPlaylistPreview] = useState<{
    title: string;
    videoCount: number;
    estimatedSeconds: number;
    videos: Array<{ videoId: string; title: string; url: string }>;
  } | null>(null);
  const [ytLoadingPreview, setYtLoadingPreview] = useState(false);
  const [ytScheduledEntry, setYtScheduledEntry] = useState<YtScheduleEntry | null>(() => {
    try {
      const raw = localStorage.getItem(YT_SCHEDULE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as YtScheduleEntry) : null;
    } catch {
      return null;
    }
  });
  const ytTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ytScanning) {
      if (ytTimerRef.current) {
        window.clearInterval(ytTimerRef.current);
        ytTimerRef.current = null;
      }
      return;
    }
    setYtElapsedSec(0);
    ytTimerRef.current = window.setInterval(() => {
      setYtElapsedSec((s) => s + 1);
    }, 1000);
    return () => {
      if (ytTimerRef.current) {
        window.clearInterval(ytTimerRef.current);
        ytTimerRef.current = null;
      }
    };
  }, [ytScanning]);

  const handlePasteYtUrl = async () => {
    setYtNotice(null);
    try {
      const text = await navigator.clipboard.readText();
      if (text?.trim()) {
        setYtUrl(text.trim());
      } else {
        setYtNotice({ kind: 'err', text: 'Bộ nhớ tạm đang trống.' });
      }
    } catch {
      setYtNotice({ kind: 'err', text: 'Hãy chạm giữ ô nhập để dán link YouTube.' });
    }
  };

  const openYoutubeModal = async (mode: 'single' | 'playlist') => {
    const trimmed = ytUrl.trim();
    if (!trimmed) {
      setYtNotice({ kind: 'err', text: 'Vui lòng dán đường dẫn YouTube trước khi quét.' });
      return;
    }
    setYtNotice(null);
    setYtModalMode(mode);
    if (mode === 'playlist') {
      setYtLoadingPreview(true);
      try {
        const res = await fetch(resolveApiUrl('/api/youtube/playlist'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: trimmed }),
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data.videos) && data.videos.length > 0) {
          setYtPlaylistPreview({
            title: data.playlistTitle || 'YouTube Playlist',
            videoCount: data.videos.length,
            estimatedSeconds: data.estimatedSeconds || data.videos.length * 18,
            videos: data.videos,
          });
        } else {
          setYtPlaylistPreview({
            title: 'YouTube Playlist',
            videoCount: 5,
            estimatedSeconds: 90,
            videos: [],
          });
        }
      } catch {
        setYtPlaylistPreview({
          title: 'YouTube Playlist',
          videoCount: 5,
          estimatedSeconds: 90,
          videos: [],
        });
      } finally {
        setYtLoadingPreview(false);
      }
    }
  };

  const buildYoutubeBookAndSave = async (
    title: string,
    chapters: Array<{ title: string; paragraphs: string[] }>
  ) => {
    const bookId = `yt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const newBook: Book = {
      id: bookId,
      title,
      author: 'YouTube Notes',
      description: 'Tạo tự động từ phụ đề văn bản công khai YouTube (Tuân thủ Store).',
      coverUrl: '',
      sourceType: 'epub',
      language: 'vi',
      readingStyle: 'novel',
      chapters: chapters.map((ch, idx) => ({
        id: `${bookId}-ch-${idx + 1}`,
        index: idx,
        title: ch.title,
        paragraphs: ch.paragraphs,
      })),
      currentChapterIndex: 0,
      currentParagraphIndex: 0,
      progressPercent: 0,
      bookmarks: [],
      highlights: [],
      addedAt: now,
      lastReadAt: now,
      voiceAssignments: {},
      characterVoicesEnabled: false,
      characterVoicesConfigured: false,
    };

    if (onAddBook) {
      await onAddBook(newBook, false);
    }
    if (onEnsureYoutubeCollection) {
      await onEnsureYoutubeCollection(bookId);
    }
  };

  const runYoutubeSingleScan = async (targetUrl?: string) => {
    const scanTarget = (targetUrl || ytUrl).trim();
    if (!scanTarget) return;
    setYtModalMode(null);
    setYtNotice(null);
    setYtScanning(true);
    setYtEstimatedTotalSec(24);
    setYtProgressLabel('Đang trích xuất phụ đề công khai...');

    try {
      const res = await fetch(resolveApiUrl('/api/youtube/transcript'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: scanTarget }),
      });
      const data = await res.json();
      if (!res.ok) {
        setYtNotice({
          kind: 'err',
          text:
            data?.code === 'NO_CAPTIONS'
              ? 'Video này chưa bật phụ đề công khai (CC). BOOKHAD chỉ quét văn bản phụ đề để tuân thủ quy định.'
              : data?.error || 'Không thể trích xuất phụ đề cho video này.',
        });
        return;
      }

      const paragraphs: string[] = Array.isArray(data.paragraphs) ? data.paragraphs : [];
      if (paragraphs.length === 0) {
        setYtNotice({ kind: 'err', text: 'Không tìm thấy nội dung văn bản phụ đề.' });
        return;
      }

      const cleanTitle = data.title || 'Ghi chú YouTube';
      await buildYoutubeBookAndSave(cleanTitle, [{ title: cleanTitle, paragraphs }]);
      setYtNotice({
        kind: 'ok',
        text: `Đã tạo EPUB "${cleanTitle}" (${paragraphs.length} đoạn) vào Kho sách riêng & /YouTube_Notes.`,
      });
    } catch {
      setYtNotice({
        kind: 'err',
        text: 'Lỗi kết nối máy chủ trích xuất phụ đề YouTube.',
      });
    } finally {
      setYtScanning(false);
      setYtProgressLabel('');
    }
  };

  const runYoutubePlaylistScan = async (mode: 'all' | 'single' | 'schedule4h') => {
    const trimmed = ytUrl.trim();
    if (!trimmed) return;
    setYtModalMode(null);

    if (mode === 'single') {
      const firstUrl = ytPlaylistPreview?.videos?.[0]?.url || trimmed;
      await runYoutubeSingleScan(firstUrl);
      return;
    }

    if (mode === 'schedule4h') {
      const now = Date.now();
      const entry: YtScheduleEntry = {
        url: trimmed,
        intervalHours: 4,
        lastScannedAt: now,
        nextScanAt: now + 4 * 3600 * 1000,
        scannedVideoIds: [],
      };
      setYtScheduledEntry(entry);
      try {
        localStorage.setItem(YT_SCHEDULE_STORAGE_KEY, JSON.stringify(entry));
      } catch {
        // ignore quota
      }
      setYtNotice({
        kind: 'ok',
        text: 'Đã bật lịch chạy ẩn định kỳ 4 tiếng quét Playlist 1 lần (chỉ phụ đề văn bản).',
      });
      return;
    }

    // Full playlist scan
    const videos = ytPlaylistPreview?.videos || [];
    if (videos.length === 0) {
      await runYoutubeSingleScan(trimmed);
      return;
    }

    const batch = videos.slice(0, 12);
    setYtScanning(true);
    setYtNotice(null);
    setYtEstimatedTotalSec(Math.max(20, batch.length * 14));
    const chapters: Array<{ title: string; paragraphs: string[] }> = [];

    try {
      for (let i = 0; i < batch.length; i++) {
        const v = batch[i];
        setYtProgressLabel(`Tập ${i + 1}/${batch.length}`);
        try {
          const res = await fetch(resolveApiUrl('/api/youtube/transcript'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: v.url }),
          });
          const data = await res.json();
          if (res.ok && Array.isArray(data.paragraphs) && data.paragraphs.length > 0) {
            chapters.push({
              title: data.title || v.title || `Tập ${i + 1}`,
              paragraphs: data.paragraphs,
            });
          }
        } catch {
          // continue next episode
        }
      }

      if (chapters.length === 0) {
        setYtNotice({
          kind: 'err',
          text: 'Các video trong Playlist chưa bật phụ đề công khai (CC).',
        });
        return;
      }

      const bookTitle = ytPlaylistPreview?.title || 'YouTube Playlist Notes';
      await buildYoutubeBookAndSave(bookTitle, chapters);
      setYtNotice({
        kind: 'ok',
        text: `Đã tạo EPUB "${bookTitle}" (${chapters.length} tập) vào Kho sách riêng & /YouTube_Notes.`,
      });
    } finally {
      setYtScanning(false);
      setYtProgressLabel('');
    }
  };

  const isRunning = crawlStatus === 'running';
  const isPaused = crawlStatus === 'paused';
  const hasIssue = crawlStatus === 'issue';
  const isCompleted = crawlStatus === 'completed';

  const activeUrlForBrowser = currentPage?.url || urlInput;
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const externalBrowserHref = buildNativeBrowserHref(
    activeUrlForBrowser,
    isNativeAndroidApp(),
    currentOrigin
  );
  const hasValidUrl = activeUrlForBrowser.trim().length > 0;

  const handleLoadUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setPasteNotice('');
    await openUrlDirectly(urlInput.trim(), true);
  };

  const handlePasteUrl = async () => {
    setPasteNotice('');
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText && clipText.trim()) {
        setUrlInput(clipText.trim());
      } else {
        setPasteNotice('Bộ nhớ tạm đang trống — hãy sao chép link truyện trước.');
      }
    } catch {
      setPasteNotice('Trình duyệt không cho đọc bộ nhớ tạm. Hãy chạm giữ ô nhập để dán link.');
    }
  };

  const handleCopyUrl = async () => {
    if (!hasValidUrl) return;
    try {
      const copyTarget = /^https?:\/\//i.test(activeUrlForBrowser.trim())
        ? activeUrlForBrowser.trim()
        : externalBrowserHref;
      await navigator.clipboard.writeText(copyTarget);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failures on restricted webviews
    }
  };

  const totalWords = scrapedList.reduce((acc, c) => acc + c.wordCount, 0);
  const resolvedIssueTitle =
    (issueReason && ISSUE_TITLES[issueReason]) ||
    'Không đọc được trang (Tạm dừng để bạn tự kiểm tra)';

  return (
    <main className="max-w-7xl mx-auto px-3.5 sm:px-6 lg:px-8 pt-3 pb-4 sm:pt-5 sm:pb-6 space-y-4 overflow-x-hidden">
      {/* 1. QUÉT TRUYỆN TỪ YOUTUBE (ĐẶT PHÍA TRÊN "DÁN LINK TRUYỆN WEB", CHỈ PHỤ ĐỀ VĂN BẢN) */}
      <section
        data-testid="youtube-scanner-section"
        aria-label="Quét phụ đề YouTube tạo EPUB"
        className="ios-elevated-card p-3 sm:p-4 rounded-2xl border border-stone-200/90 dark:border-stone-800 bg-white dark:bg-[#16181C] space-y-2.5 overflow-hidden"
      >
        {/* Running or Scheduled Indicator (only shown when active) */}
        {(ytScanning || ytScheduledEntry) && (
          <div className="flex items-center justify-end gap-2">
            {ytScanning ? (
              <div
                data-testid="youtube-scanning-indicator"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/50 text-[10px] font-medium text-amber-900 dark:text-amber-300 tabular-nums shrink-0"
              >
                <Settings className="w-3 h-3 animate-spin text-amber-800 dark:text-amber-400 shrink-0" />
                <span>
                  {ytProgressLabel ? `${ytProgressLabel} · ` : ''}
                  {formatTimerMMSS(ytElapsedSec)} / còn ~
                  {formatTimerMMSS(Math.max(0, ytEstimatedTotalSec - ytElapsedSec))}
                </span>
              </div>
            ) : ytScheduledEntry ? (
              <button
                type="button"
                onClick={() => {
                  setYtScheduledEntry(null);
                  try {
                    localStorage.removeItem(YT_SCHEDULE_STORAGE_KEY);
                  } catch {}
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[9.5px] font-semibold text-emerald-800 dark:text-emerald-300 shrink-0"
                title="Nhấn để tắt lịch quét định kỳ 4 tiếng"
              >
                <Clock className="w-2.5 h-2.5" />
                <span>Quét 4h/lần</span>
              </button>
            ) : null}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 min-w-0">
          <div className="relative flex-1 min-w-0">
            <Youtube className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
            <input
              type="text"
              data-testid="youtube-url-input"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="MP3 sang Epub"
              aria-label="MP3 sang Epub"
              className="w-full min-w-0 pl-8 pr-9 py-1.5 text-[11.5px] rounded-full ios-elevated-oval bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-zinc-700/70 min-h-[36px]"
            />
            <button
              type="button"
              onClick={handlePasteYtUrl}
              aria-label="Dán link"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-stone-500 hover:text-amber-800"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="yt-single-btn"
              disabled={ytScanning}
              onClick={() => openYoutubeModal('single')}
              className="ios-elevated-oval ios-liquid-btn inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900 disabled:opacity-45 min-h-[36px] whitespace-nowrap"
            >
              <Play className="w-3 h-3 shrink-0" />
              <span>Single video</span>
            </button>

            <button
              type="button"
              data-testid="yt-playlist-btn"
              disabled={ytScanning}
              onClick={() => openYoutubeModal('playlist')}
              className="ios-elevated-oval ios-liquid-pill inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-zinc-700 text-stone-800 dark:text-stone-100 text-[11px] font-semibold hover:border-amber-700 disabled:opacity-45 min-h-[36px] whitespace-nowrap"
            >
              <ListVideo className="w-3 h-3 shrink-0 text-amber-800 dark:text-amber-400" />
              <span>Playlist</span>
            </button>
          </div>
        </div>

        {ytNotice && (
          <div
            className={`px-3 py-2 rounded-xl text-[11px] flex items-center justify-between gap-2 ${
              ytNotice.kind === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-900'
                : 'bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-300 border border-amber-200/80 dark:border-amber-900'
            }`}
          >
            <span>{ytNotice.text}</span>
            <button type="button" onClick={() => setYtNotice(null)} className="shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>

      {/* 2. DÁN LINK TRUYỆN WEB + TRÌNH DUYỆT GỐC + AI TỰ QUÉT */}
      <section className="ios-elevated-card p-3 sm:p-4 rounded-2xl border border-stone-200/90 dark:border-stone-800 bg-white dark:bg-[#16181C] space-y-3 overflow-hidden">
        <form onSubmit={handleLoadUrl} className="space-y-2">
          <div className="flex flex-col sm:flex-row gap-2 min-w-0">
            <div className="relative flex-1 min-w-0">
              <Globe className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
              <input
                type="text"
                data-testid="web-novel-url-input"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Tìm truyện"
                aria-label="Tìm truyện"
                className="w-full min-w-0 pl-8 pr-3 py-1.5 text-[11.5px] rounded-full ios-liquid-bar border border-stone-300/80 dark:border-zinc-700/70 min-h-[36px]"
              />
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 shrink-0">
              <button
                type="submit"
                data-testid="web-read-btn"
                disabled={isFetching || isRunning}
                className="ios-liquid-btn flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] font-semibold whitespace-nowrap shrink-0 disabled:opacity-50 min-h-[34px]"
              >
                {isFetching ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Globe className="w-3 h-3" />
                )}
                <span>Đọc</span>
              </button>

              <button
                type="button"
                data-testid="web-browser-btn"
                onClick={() => setIsBrowserWindowOpen(true)}
                className="ios-liquid-pill flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full border border-amber-700/40 bg-amber-50/90 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200 text-[11px] font-semibold whitespace-nowrap shrink-0 min-h-[34px] hover:bg-amber-100/80 dark:hover:bg-amber-900/40"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                <span>Trình duyệt</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={isRunning}
              onClick={handlePasteUrl}
              className="ios-liquid-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full ios-liquid-bar border border-stone-200 dark:border-zinc-700/60 text-[10.5px] font-medium text-stone-800 dark:text-stone-100 min-h-[30px]"
            >
              <ClipboardPaste className="w-3 h-3 shrink-0" />
              <span>Dán link</span>
            </button>

            <button
              type="button"
              disabled={!hasValidUrl}
              onClick={handleCopyUrl}
              className="ios-liquid-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-stone-200 dark:border-zinc-700/60 text-[10.5px] font-medium text-stone-700 dark:text-stone-300 min-h-[30px] disabled:opacity-40"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span>Đã chép</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Sao chép link</span>
                </>
              )}
            </button>

            {pasteNotice && (
              <span className="text-[10.5px] text-amber-800 dark:text-amber-400">
                {pasteNotice}
              </span>
            )}
          </div>
        </form>

        {/* DEFAULT ENGINE: AI Tự Quét (Auto-scroll / find next-page or right-edge turn button) */}
        <div className="p-3 rounded-xl border border-amber-800/30 bg-amber-50/55 dark:bg-amber-950/20 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1 min-w-0">
              <Sparkles className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <h2 className="text-[12.5px] font-semibold text-stone-900 dark:text-stone-100">
                AI Tự Quét
              </h2>
              <button
                type="button"
                onClick={() => setShowAiHelp((v) => !v)}
                aria-expanded={showAiHelp}
                aria-label="Xem cách hoạt động của AI Tự Quét"
                className="p-1 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-white shrink-0"
              >
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${showAiHelp ? 'rotate-180' : ''}`}
                />
              </button>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <label className="inline-flex items-center gap-1 text-[11px] text-stone-700 dark:text-stone-300 shrink-0">
                <span>Quét</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={maxPages}
                  onChange={(e) => setMaxPages(Math.max(1, Math.min(200, Number(e.target.value))))}
                  aria-label="Số chương AI quét tối đa"
                  className="w-12 px-1.5 py-0.5 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[11px] text-center tabular-nums"
                />
                <span>ch</span>
              </label>

              {!isRunning && !isPaused && (
                <button
                  type="button"
                  onClick={() => startAiAutoScanAndSave()}
                  aria-label="AI Tự Quét và lưu EPUB"
                  className="ios-liquid-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900 shadow-xs shrink-0"
                >
                  <Sparkles className="w-2.5 h-2.5 shrink-0" />
                  <span>Quét</span>
                </button>
              )}
            </div>
          </div>

          {showAiHelp && (
            <p className="text-[11px] leading-[1.4] text-stone-600 dark:text-stone-400">
              AI mặc định tự lướt xuống tìm nút sang chương hoặc nút chuyển trang bên phải để đọc liên tục và đóng gói thành sách .EPUB sạch. Nếu gặp trang đóng phí, bắt đăng nhập hay Captcha, hệ thống sẽ dừng và báo ngay để bạn bấm (X) tự kiểm tra.
            </p>
          )}

          {(isRunning || isPaused || showAiHelp) && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
              <label className="inline-flex items-center gap-1.5 text-[10.5px] text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSaveAndExportEpub}
                  onChange={(e) => setAutoSaveAndExportEpub(e.target.checked)}
                  className="accent-amber-800 w-3.5 h-3.5 shrink-0"
                />
                <span>Tự lưu Thư viện &amp; tải .EPUB sau khi quét</span>
              </label>

              {(isRunning || isPaused) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={togglePause}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                      isRunning
                        ? 'bg-amber-700 text-white hover:bg-amber-800'
                        : 'bg-emerald-700 text-white hover:bg-emerald-800'
                    }`}
                  >
                    {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                    <span>{isRunning ? 'Tạm dừng' : 'Tiếp tục'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMinimized(!isMinimized)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    {isMinimized ? (
                      <>
                        <Maximize2 className="w-3 h-3" />
                        <span>Mở khung</span>
                      </>
                    ) : (
                      <>
                        <Minimize2 className="w-3 h-3" />
                        <span>Thu nhỏ</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={stopAndResetStatus}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-300 text-red-700 dark:text-red-400 text-[11px] font-medium hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Square className="w-3 h-3" />
                    <span>Dừng</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status / Minimized Background Status */}
        {statusMessage && !hasIssue && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-3.5 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="font-medium break-words">{statusMessage}</div>
                {activeScanStepLabel && (
                  <div className="text-[11px] opacity-80 truncate">{activeScanStepLabel}</div>
                )}
              </div>
            </div>
            {isCompleted && scrapedList.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => saveScrapedToLibrary()}
                  className="px-3 py-1.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] font-medium"
                >
                  Mở đọc trong Thư viện
                </button>
                <button
                  type="button"
                  onClick={() => exportScrapedEpub()}
                  className="px-3 py-1.5 rounded-lg bg-amber-800 text-white text-[11px] font-medium"
                >
                  Tải lại .EPUB
                </button>
              </div>
            )}
          </div>
        )}

        {/* Smart Issue / Paywall / Login / Captcha Recovery Alert with top-right X dismiss */}
        {hasIssue && (
          <div
            role="alert"
            className="relative p-3.5 sm:p-4 rounded-2xl border border-red-300 dark:border-red-800 bg-red-50/90 dark:bg-red-950/40 space-y-3"
          >
            <button
              type="button"
              onClick={dismissIssueAlert}
              aria-label="Đóng thông báo lỗi để tự kiểm tra"
              title="Đóng thông báo để tự kiểm tra"
              className="absolute top-2.5 right-2.5 w-7 h-7 rounded-full bg-red-200/70 dark:bg-red-900/60 hover:bg-red-300/80 dark:hover:bg-red-800/80 text-red-900 dark:text-red-100 flex items-center justify-center transition-transform active:scale-90"
            >
              <X className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-start gap-2.5 pr-8 text-red-900 dark:text-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <div className="text-[12.5px] font-semibold leading-snug">
                  {resolvedIssueTitle}
                </div>
                <p className="text-[11.5px] leading-relaxed">{issueMessage}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-0.5">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                aria-label="Sửa đường dẫn URL để tiếp tục quét"
                placeholder="Sửa URL chương tiếp theo rồi nhấn Quét tiếp..."
                className="flex-1 min-w-0 px-3 py-1.5 rounded-xl border border-red-300 dark:border-red-800 bg-white dark:bg-stone-900 text-xs"
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setIsBrowserWindowOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-amber-700/40 bg-white dark:bg-stone-900 text-amber-900 dark:text-amber-300 text-[11px] font-medium"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>Tự kiểm tra</span>
                </button>
                <button
                  type="button"
                  disabled={scrapedList.length === 0}
                  onClick={() => exportScrapedEpub()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[11px] font-medium disabled:opacity-40"
                >
                  <Download className="w-3 h-3" />
                  <span>Lưu .EPUB</span>
                </button>
                <button
                  type="button"
                  onClick={resumeAfterIssue}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-800 text-white text-[11px] font-semibold hover:bg-amber-900"
                >
                  <Play className="w-3 h-3" />
                  <span>Quét tiếp</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Main Split Workspace or Minimized Background Runner */}
      {isMinimized && !hasIssue ? (
        <section
          aria-label="Trình AI quét trang Web chạy ngầm"
          className="p-5 sm:p-6 rounded-2xl border border-amber-800/30 bg-white dark:bg-[#16181C] flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="space-y-1.5 min-w-0">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-400">
              {isRunning ? (
                <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              ) : (
                <Sparkles className="w-4 h-4 shrink-0" />
              )}
              <span>
                {isRunning
                  ? 'AI đang tự lướt tìm nút sang trang & quét ngầm...'
                  : isCompleted
                  ? 'AI đã quét xong! File .EPUB sẵn sàng trong Thư viện.'
                  : 'Trình AI quét web đang tạm dừng.'}
              </span>
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-400">
              Đã gom <strong>{scrapedList.length} chương</strong> ({totalWords.toLocaleString('vi-VN')} từ). Chương gần nhất: <strong>{currentPage?.title || 'Đang chờ...'}</strong>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsMinimized(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-stone-300 dark:border-stone-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Xem khung đọc &amp; Danh sách</span>
            </button>
            <button
              type="button"
              disabled={scrapedList.length === 0}
              onClick={() => exportScrapedEpub()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải .EPUB ({scrapedList.length} ch)</span>
            </button>
          </div>
        </section>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Live Web Reader Pane */}
          <section
            aria-label="Khung đọc nội dung trang web"
            className="lg:col-span-7 border border-stone-200 dark:border-stone-800 rounded-xl bg-white dark:bg-[#191B1F] overflow-hidden min-w-0"
          >
            <div className="px-4 sm:px-5 py-3.5 border-b border-stone-200 dark:border-stone-800 flex flex-wrap items-center justify-between gap-2.5 bg-stone-50 dark:bg-stone-900/50">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-stone-800 dark:text-stone-200 truncate">
                  {currentPage ? currentPage.title : 'Khung đọc trực tiếp trên Web'}
                </div>
                <div className="text-[11px] text-stone-500 truncate">
                  {currentPage
                    ? currentPage.url
                    : 'Dán link truyện để đọc trực tiếp hoặc nhấn "Quét" để AI tự lướt sang trang'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentPage && (
                  <button
                    type="button"
                    onClick={() => setIsBrowserWindowOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800 whitespace-nowrap"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Trình duyệt</span>
                  </button>
                )}
                {currentPage?.nextUrl && (
                  <button
                    type="button"
                    disabled={isFetching || isRunning}
                    onClick={() => openUrlDirectly(currentPage.nextUrl!, true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-amber-800 text-white text-[11px] font-medium hover:bg-amber-900 whitespace-nowrap"
                  >
                    <span>{currentPage.nextLabel || 'Trang tiếp'}</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="p-5 sm:p-6 max-h-[540px] overflow-y-auto space-y-4 font-book text-base leading-relaxed text-stone-800 dark:text-stone-200">
              {!currentPage ? (
                <div className="py-12 text-center font-sans text-xs text-stone-500 space-y-2">
                  <p>Chưa có trang web nào được mở.</p>
                  <p>Dán link truyện để đọc trực tiếp, mở trình duyệt gốc hoặc bấm &ldquo;Quét&rdquo; để AI tự lấy sách.</p>
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-display font-semibold text-stone-900 dark:text-stone-100">
                    {currentPage.title}
                  </h2>
                  {currentPage.paragraphs.map((p, i) => (
                    <p key={i} className="text-justify">
                      {p}
                    </p>
                  ))}
                  {currentPage.nextUrl && (
                    <div className="pt-4 border-t border-stone-200 dark:border-stone-800 flex justify-end font-sans">
                      <button
                        type="button"
                        disabled={isFetching || isRunning}
                        onClick={() => openUrlDirectly(currentPage.nextUrl!, true)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-amber-700 text-amber-800 dark:text-amber-400 text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      >
                        <Play className="w-3 h-3" />
                        <span>Đọc tiếp: {currentPage.nextLabel || 'Chương tiếp'}</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          {/* Compiled Chapters Queue & EPUB Naming / Saver (Right) */}
          <section
            aria-label="Danh sách chương đã quét và xuất EPUB"
            className="lg:col-span-5 border border-stone-200 dark:border-stone-800 rounded-xl bg-white dark:bg-[#191B1F] p-4 sm:p-5 space-y-4 overflow-hidden min-w-0"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                  Chương đã quét ({scrapedList.length})
                </h2>
                <p className="text-[11px] text-stone-500 tabular-nums">
                  {totalWords.toLocaleString('vi-VN')} từ · Sẵn sàng đóng gói .EPUB
                </p>
              </div>
              {scrapedList.length > 0 && (
                <TwoTapDeleteButton
                  variant="pill"
                  label="Xóa hết"
                  confirmLabel="Xác nhận xóa hết"
                  onConfirmDelete={() => setScrapedList([])}
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Đặt tên sách EPUB</label>
                <input
                  type="text"
                  value={compiledTitle}
                  onChange={(e) => setCompiledTitle(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Tác giả</label>
                <input
                  type="text"
                  value={compiledAuthor}
                  onChange={(e) => setCompiledAuthor(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1 flex items-center gap-1">
                  <FolderOpen className="w-3 h-3" />
                  <span>Bộ sưu tập</span>
                </label>
                <input
                  type="text"
                  value={compiledCollection}
                  onChange={(e) => setCompiledCollection(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-stone-300 dark:border-stone-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Phong cách giọng</label>
                <GlassSelect
                  value={compiledStyle}
                  onChange={(v) => setCompiledStyle(v as BookReadingStyle)}
                  options={STYLE_OPTIONS}
                  title="Chọn phong cách giọng"
                  ariaLabel="Chọn phong cách giọng"
                  buttonClassName="py-1.5 rounded-xl"
                />
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {scrapedList.length === 0 ? (
                <div className="py-10 text-center text-xs text-stone-500 border border-dashed border-stone-200 dark:border-stone-800 rounded-lg">
                  Các chương AI tự quét sẽ được gom sạch tại đây và tự lưu thành file .EPUB.
                </div>
              ) : (
                scrapedList.map((item, idx) => (
                  <div
                    key={item.id}
                    className="perf-list-item flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/40 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-stone-900 dark:text-stone-100 truncate">
                        {idx + 1}. {item.title}
                      </div>
                      <div className="text-[11px] text-stone-500 tabular-nums">
                        {item.wordCount} từ · {item.paragraphs.length} đoạn
                      </div>
                    </div>
                    <TwoTapDeleteButton
                      variant="icon"
                      title={`Xóa chương ${item.title}`}
                      onConfirmDelete={() =>
                        setScrapedList((prev) => prev.filter((c) => c.id !== item.id))
                      }
                    />
                  </div>
                ))
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-stone-200 dark:border-stone-800">
              <button
                type="button"
                onClick={() => saveScrapedToLibrary()}
                disabled={scrapedList.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium disabled:opacity-40 min-h-[42px]"
              >
                <BookPlus className="w-4 h-4" />
                <span>Lưu vào Thư viện</span>
              </button>
              <button
                type="button"
                onClick={() => exportScrapedEpub()}
                disabled={scrapedList.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 disabled:opacity-40 min-h-[42px]"
              >
                <Download className="w-4 h-4" />
                <span>Trích xuất .EPUB</span>
              </button>
            </div>
          </section>
        </div>
      )}

      {/* Full-Screen In-App Native Browser Window (strictly 3 top buttons: Quay lại / AI bắt đầu quét / Chạy ẩn) */}
      <InAppBrowserWindow
        open={isBrowserWindowOpen}
        initialUrl={activeUrlForBrowser}
        crawler={crawler}
        onClose={() => setIsBrowserWindowOpen(false)}
        onBackgroundToLibrary={() => {
          setIsBrowserWindowOpen(false);
          onBackgroundToLibrary?.();
        }}
        onUrlChange={(nextUrl) => setUrlInput(nextUrl)}
      />

      {/* YouTube Confirmation Modal: Video lẻ */}
      <IosSheet
        isOpen={ytModalMode === 'single'}
        onClose={() => setYtModalMode(null)}
        ariaLabel="Xác nhận quét Video lẻ"
        variant="center-dialog"
        zIndexClass="z-[105]"
        panelClassName="w-full sm:max-w-sm rounded-[24px] text-stone-900 dark:text-stone-100 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/70 dark:border-white/10">
          <h3 className="text-[13px] font-sans font-bold">Xác nhận quét Video lẻ</h3>
          <button
            type="button"
            onClick={() => setYtModalMode(null)}
            aria-label="Đóng"
            className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-xs">
          <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200/80 dark:border-stone-800 space-y-1">
            <div className="font-semibold text-stone-900 dark:text-stone-100">
              Quét toàn bộ phụ đề video &amp; đóng gói EPUB
            </div>
            <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
              AI sẽ trích xuất văn bản phụ đề công khai, làm sạch dấu câu và tự lưu thành sách EPUB
              trong <strong>Kho sách riêng</strong> và thư mục <strong>/YouTube_Notes</strong>.
            </p>
            <div className="pt-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 dark:text-amber-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Thời gian ước tính: ~20 – 35 giây</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setYtModalMode(null)}
              className="ios-elevated-oval py-2.5 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-[#1C1E24] font-semibold text-stone-700 dark:text-stone-200"
            >
              Hủy
            </button>
            <button
              type="button"
              data-testid="confirm-yt-single-scan-btn"
              onClick={() => runYoutubeSingleScan()}
              className="ios-elevated-oval py-2.5 rounded-full bg-amber-800 text-white font-semibold hover:bg-amber-900"
            >
              Bắt đầu quét
            </button>
          </div>
        </div>
      </IosSheet>

      {/* YouTube Confirmation Modal: Link Playlist (3 options) */}
      <IosSheet
        isOpen={ytModalMode === 'playlist'}
        onClose={() => setYtModalMode(null)}
        ariaLabel="Tùy chọn quét Playlist YouTube"
        variant="center-dialog"
        zIndexClass="z-[105]"
        panelClassName="w-full sm:max-w-md rounded-[24px] text-stone-900 dark:text-stone-100 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200/70 dark:border-white/10">
          <h3 className="text-[13px] font-sans font-bold">Tùy chọn quét Playlist YouTube</h3>
          <button
            type="button"
            onClick={() => setYtModalMode(null)}
            aria-label="Đóng"
            className="w-7 h-7 rounded-full bg-black/5 dark:bg-white/10 flex items-center justify-center text-stone-600 dark:text-stone-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-3 text-xs">
          <div className="p-3 rounded-2xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200/80 dark:border-stone-800 space-y-1">
            {ytLoadingPreview ? (
              <div className="flex items-center gap-2 text-stone-600 dark:text-stone-300">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-800" />
                <span>Đang kiểm tra danh sách phát...</span>
              </div>
            ) : (
              <>
                <div className="font-semibold text-stone-900 dark:text-stone-100 truncate">
                  {ytPlaylistPreview?.title || 'YouTube Playlist'}
                </div>
                <div className="text-[11px] text-stone-600 dark:text-stone-400">
                  Phát hiện {ytPlaylistPreview?.videoCount || 1} video · Chỉ đọc phụ đề công khai,
                  lưu vào <strong>/YouTube_Notes</strong>.
                </div>
              </>
            )}
          </div>

          {/* Row 1: (1) Quét cả Playlist + (2) Quét đơn side-by-side */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="confirm-yt-playlist-all-btn"
              onClick={() => runYoutubePlaylistScan('all')}
              className="ios-elevated-oval p-2.5 rounded-2xl bg-amber-800 text-white text-left space-y-0.5 hover:bg-amber-900"
            >
              <div className="text-[11.5px] font-semibold">Quét cả Playlist</div>
              <div className="text-[10px] text-amber-100/90 tabular-nums">
                Ước tính ~{Math.max(1, Math.ceil((ytPlaylistPreview?.estimatedSeconds || 90) / 60))}{' '}
                phút
              </div>
            </button>

            <button
              type="button"
              data-testid="confirm-yt-playlist-single-btn"
              onClick={() => runYoutubePlaylistScan('single')}
              className="ios-elevated-oval p-2.5 rounded-2xl bg-white dark:bg-[#1C1E24] border border-stone-200 dark:border-stone-700 text-stone-900 dark:text-stone-100 text-left space-y-0.5 hover:border-amber-700"
            >
              <div className="text-[11.5px] font-semibold">Quét đơn</div>
              <div className="text-[10px] text-stone-500 dark:text-stone-400 tabular-nums">
                Ước tính ~25 giây
              </div>
            </button>
          </div>

          {/* Row 2: (3) Chạy ẩn định kỳ 4 tiếng quét 1 lần */}
          <button
            type="button"
            data-testid="confirm-yt-playlist-4h-btn"
            onClick={() => runYoutubePlaylistScan('schedule4h')}
            className="w-full ios-elevated-oval px-3.5 py-2.5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11.5px] font-semibold inline-flex items-center justify-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span>Chạy ẩn định kỳ 4 tiếng quét 1 lần</span>
          </button>
        </div>
      </IosSheet>
    </main>
  );
};
