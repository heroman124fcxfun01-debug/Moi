import React, { useState } from 'react';
import {
  Globe,
  Play,
  Pause,
  Square,
  Download,
  BookPlus,
  ChevronRight,
  Trash2,
  Loader2,
  CheckCircle2,
  MousePointerClick,
  Plus,
  Minimize2,
  Maximize2,
  AlertTriangle,
  Crosshair,
  FolderOpen,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
} from 'lucide-react';
import type { BookReadingStyle } from '../types/book';
import type { WebCrawlerController } from '../hooks/useWebCrawler';

interface WebScraperViewProps {
  crawler: WebCrawlerController;
}

function buildNativeBrowserHref(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '#';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) {
    if (typeof window !== 'undefined') {
      return `${window.location.origin}${trimmed}`;
    }
    return trimmed;
  }
  return `https://${trimmed}`;
}

export const WebScraperView: React.FC<WebScraperViewProps> = ({ crawler }) => {
  const {
    urlInput,
    setUrlInput,
    macroSteps,
    addMacroStep,
    updateMacroStep,
    removeMacroStep,
    pickingStepId,
    setPickingStepId,
    applyInteractiveTargetToStep,
    maxPages,
    setMaxPages,
    useAiScan,
    setUseAiScan,
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
    activeMacroStepLabel,
    compiledTitle,
    setCompiledTitle,
    compiledAuthor,
    setCompiledAuthor,
    compiledCollection,
    setCompiledCollection,
    compiledStyle,
    setCompiledStyle,
    openUrlDirectly,
    setAndStartBackgroundCrawl,
    startAiAutoScanAndSave,
    resumeAfterIssue,
    togglePause,
    stopAndResetStatus,
    saveScrapedToLibrary,
    exportScrapedEpub,
  } = crawler;

  const [copiedLink, setCopiedLink] = useState(false);

  const isRunning = crawlStatus === 'running';
  const isPaused = crawlStatus === 'paused';
  const hasIssue = crawlStatus === 'issue';
  const isCompleted = crawlStatus === 'completed';

  const activeUrlForBrowser = currentPage?.url || urlInput;
  const externalBrowserHref = buildNativeBrowserHref(activeUrlForBrowser);
  const hasValidUrl = activeUrlForBrowser.trim().length > 0;

  const handleLoadUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    await openUrlDirectly(urlInput.trim(), true);
  };

  const handleCopyUrl = async () => {
    if (!hasValidUrl) return;
    try {
      await navigator.clipboard.writeText(externalBrowserHref);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      // Ignore clipboard failures on restricted webviews
    }
  };

  const totalWords = scrapedList.reduce((acc, c) => acc + c.wordCount, 0);

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-4 sm:pt-8 sm:pb-5 space-y-6 overflow-x-hidden">
      <header className="pb-4 border-b border-stone-200 dark:border-stone-800 text-center">
        <h1 className="text-2xl sm:text-3xl font-display font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Cộng đồng
        </h1>
      </header>

      {/* URL Input + Open Native Browser + AI Auto-Scan & Save EPUB */}
      <section className="p-4 sm:p-5 rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#16181C] space-y-4 overflow-hidden">
        <form onSubmit={handleLoadUrl} className="space-y-2.5">
          <div className="flex flex-col sm:flex-row gap-2.5 min-w-0">
            <div className="relative flex-1 min-w-0">
              <Globe className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 z-10 pointer-events-none" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Dán link trang web đọc truyện / sách (https://...)"
                aria-label="Đường dẫn trang web cần đọc và quét"
                className="w-full min-w-0 pl-10 pr-4 py-2.5 text-xs rounded-full ios-liquid-bar border border-stone-300/80 dark:border-zinc-700/70 min-h-[44px]"
              />
            </div>

            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={isFetching || isRunning}
                className="ios-liquid-btn flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-semibold whitespace-nowrap shrink-0 disabled:opacity-50 min-h-[44px]"
              >
                {isFetching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Globe className="w-3.5 h-3.5" />
                )}
                <span>Đọc tại đây</span>
              </button>

              {/* Native Device Browser External Link (uses <a> target="_blank", never window.open) */}
              <a
                href={hasValidUrl ? externalBrowserHref : undefined}
                target="_blank"
                rel="noopener noreferrer"
                aria-disabled={!hasValidUrl}
                className={`ios-liquid-pill flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-full border border-amber-700/40 bg-amber-50/90 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200 text-xs font-semibold whitespace-nowrap shrink-0 min-h-[44px] hover:bg-amber-100/80 dark:hover:bg-amber-900/40 ${
                  !hasValidUrl ? 'pointer-events-none opacity-45' : ''
                }`}
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span>Mở bằng trình duyệt gốc</span>
              </a>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isRunning}
              onClick={() => {
                setCompiledTitle('Bí Mật Tháp Đồng Hồ');
                setCompiledAuthor('Truyện Web Mẫu');
                setCompiledCollection('Truyện Web Mẫu');
                setCompiledStyle('novel');
                setUrlInput('/demo-web-book/chap-1');
                openUrlDirectly('/demo-web-book/chap-1', true);
              }}
              className="ios-liquid-pill px-3.5 py-2 rounded-full ios-liquid-bar border border-stone-200 dark:border-zinc-700/60 text-xs font-medium text-stone-800 dark:text-stone-100 max-w-full min-h-[38px]"
            >
              Truyện mẫu (5 chương)
            </button>

            <button
              type="button"
              disabled={isRunning}
              onClick={() => {
                setUrlInput('/demo-web-book/chap-vip');
                openUrlDirectly('/demo-web-book/chap-vip', true);
              }}
              className="ios-liquid-pill px-3.5 py-2 rounded-full ios-liquid-bar border border-amber-700/35 text-amber-800 dark:text-amber-300 text-xs font-medium max-w-full min-h-[38px]"
            >
              Thử trang khóa VIP
            </button>

            <button
              type="button"
              disabled={!hasValidUrl}
              onClick={handleCopyUrl}
              className="ios-liquid-pill inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-stone-200 dark:border-zinc-700/60 text-xs font-medium text-stone-700 dark:text-stone-300 min-h-[38px] disabled:opacity-40"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Đã sao chép link</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Sao chép link</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* PRIMARY WORKFLOW: AI Auto-Scan Web Reader & Auto-Save to .EPUB */}
        <div className="p-4 rounded-2xl border border-amber-800/30 bg-amber-50/55 dark:bg-amber-950/20 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-0.5">
              <h2 className="text-xs sm:text-sm font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                <span>AI Tự Quét Trang Đọc Sách &amp; Tự Lưu Thành File .EPUB</span>
              </h2>
              <p className="text-[11px] text-stone-600 dark:text-stone-400">
                AI tự lọc bỏ quảng cáo, tự tìm nút sang chương tiếp theo trên trang trình duyệt và đóng gói lưu trực tiếp thành file sách .EPUB sạch.
              </p>
            </div>

            <label className="inline-flex items-center gap-1.5 text-[11px] text-stone-700 dark:text-stone-300 shrink-0">
              <span>Quét tối đa</span>
              <input
                type="number"
                min={1}
                max={200}
                value={maxPages}
                onChange={(e) => setMaxPages(Math.max(1, Math.min(200, Number(e.target.value))))}
                aria-label="Số chương AI quét tối đa"
                className="w-16 px-2 py-1 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs tabular-nums"
              />
              <span>chương</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-stone-300 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSaveAndExportEpub}
                onChange={(e) => setAutoSaveAndExportEpub(e.target.checked)}
                className="accent-amber-800 w-4 h-4 shrink-0"
              />
              <span>Tự động lưu vào Thư viện &amp; tải file .EPUB ngay sau khi AI quét xong</span>
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {!isRunning && !isPaused && (
                <button
                  type="button"
                  onClick={startAiAutoScanAndSave}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900 min-h-[42px] shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Tự Quét &amp; Lưu .EPUB</span>
                </button>
              )}

              {(isRunning || isPaused) && (
                <>
                  <button
                    type="button"
                    onClick={togglePause}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-semibold min-h-[42px] ${
                      isRunning
                        ? 'bg-amber-700 text-white hover:bg-amber-800'
                        : 'bg-emerald-700 text-white hover:bg-emerald-800'
                    }`}
                  >
                    {isRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{isRunning ? 'Tạm dừng AI quét' : 'Tiếp tục quét'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsMinimized(!isMinimized)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full border border-stone-300 dark:border-stone-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800 min-h-[42px]"
                  >
                    {isMinimized ? (
                      <>
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Mở khung đọc</span>
                      </>
                    ) : (
                      <>
                        <Minimize2 className="w-3.5 h-3.5" />
                        <span>Thu nhỏ chạy ngầm</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={stopAndResetStatus}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-full border border-red-300 text-red-700 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/30 min-h-[42px]"
                  >
                    <Square className="w-3.5 h-3.5" />
                    <span>Dừng hẳn</span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Collapsible Advanced Manual Macro AutoClick (tucked cleanly out of the way) */}
        <details className="rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50/50 dark:bg-stone-900/30">
          <summary className="px-3.5 py-2.5 text-xs font-medium text-stone-600 dark:text-stone-400 cursor-pointer flex items-center justify-between gap-2 select-none">
            <span className="inline-flex items-center gap-1.5">
              <MousePointerClick className="w-3.5 h-3.5 text-stone-500" />
              <span>Tùy chỉnh nâng cao: Macro AutoClick thủ công (dành cho trang đặc biệt)</span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          </summary>

          <div className="px-3.5 pb-3.5 pt-2 border-t border-stone-200/70 dark:border-stone-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-[11px] text-stone-600 dark:text-stone-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!useAiScan}
                  onChange={(e) => setUseAiScan(!e.target.checked)}
                  className="accent-amber-800"
                />
                <span>Dùng chuỗi CSS Selector thủ công thay cho AI tự quét</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={addMacroStep}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Thêm bước Click</span>
                </button>
                {!isRunning && !isPaused && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseAiScan(false);
                      setAndStartBackgroundCrawl();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-800 dark:bg-stone-200 text-white dark:text-stone-900 text-[11px] font-semibold"
                  >
                    <Play className="w-3 h-3" />
                    <span>Chạy Macro thủ công</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {macroSteps.map((step, idx) => {
                const isPicking = pickingStepId === step.id;
                return (
                  <div
                    key={step.id}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-center p-2.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 text-xs overflow-hidden"
                  >
                    <div className="lg:col-span-4 flex items-center gap-2 min-w-0">
                      <span className="w-6 h-6 rounded-full bg-amber-800 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={step.label}
                        onChange={(e) => updateMacroStep(step.id, { label: e.target.value })}
                        aria-label={`Tên bước Macro ${idx + 1}`}
                        className="w-full min-w-0 px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                      />
                    </div>
                    <div className="lg:col-span-5 flex items-center gap-1.5 min-w-0">
                      <input
                        type="text"
                        value={step.selector}
                        onChange={(e) => updateMacroStep(step.id, { selector: e.target.value })}
                        placeholder="CSS Selector (.next-chapter-btn)"
                        aria-label={`Selector bước Macro ${idx + 1}`}
                        className="flex-1 min-w-0 w-full px-2.5 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setPickingStepId(isPicking ? null : step.id)}
                        title="Chọn trực tiếp nút trên trang web"
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap shrink-0 ${
                          isPicking
                            ? 'bg-amber-800 text-white border-amber-800'
                            : 'border-stone-300 dark:border-stone-700 hover:border-amber-800'
                        }`}
                      >
                        <Crosshair className="w-3 h-3 shrink-0" />
                        <span>{isPicking ? 'Đang chọn...' : 'Chọn nút'}</span>
                      </button>
                    </div>
                    <div className="lg:col-span-3 flex items-center justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-[11px] text-stone-500 whitespace-nowrap">Sau:</span>
                        <input
                          type="number"
                          min={100}
                          max={30000}
                          step={50}
                          value={step.delayMs}
                          onChange={(e) =>
                            updateMacroStep(step.id, {
                              delayMs: Math.max(100, Number(e.target.value)),
                            })
                          }
                          aria-label={`Mili giây chờ bước ${idx + 1}`}
                          className="w-20 min-w-0 px-2 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs tabular-nums"
                        />
                        <span className="text-[11px] text-stone-500 shrink-0">ms</span>
                      </div>
                      {macroSteps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeMacroStep(step.id)}
                          aria-label={`Xóa bước ${idx + 1}`}
                          className="p-1.5 rounded text-stone-400 hover:text-red-600 shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </details>

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
                {activeMacroStepLabel && (
                  <div className="text-[11px] opacity-80 truncate">{activeMacroStepLabel}</div>
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

        {/* Smart Issue / Paywall Recovery Alert */}
        {hasIssue && (
          <div
            role="alert"
            className="p-4 rounded-xl border border-red-300 dark:border-red-800 bg-red-50/80 dark:bg-red-950/35 space-y-3"
          >
            <div className="flex items-start gap-2.5 text-red-900 dark:text-red-200">
              <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-sm font-semibold">
                  Quét đang có vấn đề (Tạm dừng bảo vệ dữ liệu)
                </div>
                <p className="text-xs leading-relaxed">{issueMessage}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-1">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                aria-label="Sửa đường dẫn URL để tiếp tục quét"
                placeholder="Tự sửa URL chương tiếp theo sạch rồi nhấn Bắt đầu tiếp..."
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-red-300 dark:border-red-800 bg-white dark:bg-stone-900 text-xs"
              />
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={externalBrowserHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-700/40 bg-white dark:bg-stone-900 text-amber-900 dark:text-amber-300 text-xs font-medium"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Mở trình duyệt gốc</span>
                </a>
                <button
                  type="button"
                  disabled={scrapedList.length === 0}
                  onClick={() => exportScrapedEpub()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-medium disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Lưu .EPUB</span>
                </button>
                <button
                  type="button"
                  onClick={resumeAfterIssue}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-800 text-white text-xs font-semibold hover:bg-amber-900"
                >
                  <Play className="w-3.5 h-3.5" />
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
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : <Sparkles className="w-4 h-4 shrink-0" />}
              <span>
                {isRunning
                  ? 'AI đang tự quét từng chương web chạy ngầm...'
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
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
                  {currentPage ? currentPage.url : 'Nhấn "Đọc tại đây", "Mở bằng trình duyệt gốc" hoặc "AI Tự Quét & Lưu .EPUB"'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {currentPage && (
                  <a
                    href={buildNativeBrowserHref(currentPage.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-[11px] font-medium hover:bg-stone-100 dark:hover:bg-stone-800 whitespace-nowrap"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Trình duyệt gốc</span>
                  </a>
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

            {/* Interactive Pick-Target Strip (shown when picking a macro target) */}
            {pickingStepId && currentPage?.interactiveLinks && currentPage.interactiveLinks.length > 0 && (
              <div className="px-5 py-2.5 border-b border-stone-200 dark:border-stone-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-1.5">
                <div className="text-[11px] font-medium text-amber-900 dark:text-amber-200">
                  Bấm vào một nút bên dưới để gán cho bước Macro AutoClick:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {currentPage.interactiveLinks.slice(0, 8).map((target, tIdx) => (
                    <button
                      key={`${target.selector}-${tIdx}`}
                      type="button"
                      onClick={() => applyInteractiveTargetToStep(target)}
                      className="px-2.5 py-1 rounded-md border border-amber-700 bg-amber-100 dark:bg-amber-900/60 text-amber-900 dark:text-amber-100 text-[11px] font-medium max-w-full truncate"
                    >
                      {target.label}{' '}
                      <span className="opacity-60 font-mono text-[10px]">({target.selector})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="p-5 sm:p-6 max-h-[540px] overflow-y-auto space-y-4 font-book text-base leading-relaxed text-stone-800 dark:text-stone-200">
              {!currentPage ? (
                <div className="py-14 text-center font-sans text-xs text-stone-500 space-y-2">
                  <p>Chưa có trang web nào được mở.</p>
                  <p>Dán link truyện để đọc trực tiếp, mở bằng trình duyệt gốc của máy hoặc nhấn &ldquo;AI Tự Quét &amp; Lưu .EPUB&rdquo;.</p>
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
                  Tổng hợp chương đã quét ({scrapedList.length} chương)
                </h2>
                <p className="text-[11px] text-stone-500 tabular-nums">
                  Tổng cộng {totalWords.toLocaleString('vi-VN')} từ · Sẵn sàng đóng gói .EPUB
                </p>
              </div>
              {scrapedList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setScrapedList([])}
                  className="text-[11px] text-stone-500 hover:text-red-600 shrink-0"
                >
                  Xóa danh sách
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Đặt tên sách EPUB</label>
                <input
                  type="text"
                  value={compiledTitle}
                  onChange={(e) => setCompiledTitle(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Tác giả</label>
                <input
                  type="text"
                  value={compiledAuthor}
                  onChange={(e) => setCompiledAuthor(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1 flex items-center gap-1">
                  <FolderOpen className="w-3 h-3" />
                  <span>Thư mục Bộ sưu tập</span>
                </label>
                <input
                  type="text"
                  value={compiledCollection}
                  onChange={(e) => setCompiledCollection(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-transparent"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Văn phong AI</label>
                <select
                  value={compiledStyle}
                  onChange={(e) => setCompiledStyle(e.target.value as BookReadingStyle)}
                  className="w-full px-3 py-1.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                >
                  <option value="novel">Tiểu thuyết</option>
                  <option value="selfhelp">Văn phong học tập</option>
                  <option value="essay">Tản văn</option>
                  <option value="research">Nghiên cứu</option>
                </select>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
              {scrapedList.length === 0 ? (
                <div className="py-10 text-center text-xs text-stone-500 border border-dashed border-stone-200 dark:border-stone-800 rounded-lg">
                  Các chương AI tự quét từ trang trình duyệt đọc sách sẽ được gom sạch tại đây và tự lưu thành file .EPUB.
                </div>
              ) : (
                scrapedList.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-stone-200 dark:border-stone-800 bg-stone-50/70 dark:bg-stone-900/40 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-stone-900 dark:text-stone-100 truncate">
                        {idx + 1}. {item.title}
                      </div>
                      <div className="text-[11px] text-stone-500 tabular-nums">
                        {item.wordCount} từ · {item.paragraphs.length} đoạn
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setScrapedList((prev) => prev.filter((c) => c.id !== item.id))
                      }
                      aria-label={`Xóa chương ${item.title}`}
                      className="p-1.5 rounded text-stone-400 hover:text-red-600 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-stone-200 dark:border-stone-800">
              <button
                type="button"
                onClick={() => saveScrapedToLibrary()}
                disabled={scrapedList.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium disabled:opacity-40 min-h-[44px]"
              >
                <BookPlus className="w-4 h-4" />
                <span>Lưu vào Thư viện</span>
              </button>
              <button
                type="button"
                onClick={() => exportScrapedEpub()}
                disabled={scrapedList.length === 0}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 disabled:opacity-40 min-h-[44px]"
              >
                <Download className="w-4 h-4" />
                <span>Trích xuất .EPUB</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
};
