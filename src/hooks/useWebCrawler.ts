import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookReadingStyle, Chapter, ScrapedChapterDraft } from '../types/book';
import { buildEpubBlob } from '../utils/epubBuilder';
import { downloadBlob, slugifyFilename } from '../utils/fileHelpers';
import { resolveApiUrl } from '../utils/apiClient';
import { computeBookFingerprint } from '../utils/syncAndStats';
import {
  type CrawlStatus,
  type MacroStep,
  type WebIssueReason,
  detectDuplicateOrLoop,
  detectPaywallOrIssue,
} from '../utils/webCrawlerEngine';

const DEFAULT_MACRO_STEPS: MacroStep[] = [
  {
    id: 'step-1',
    label: 'Click 1 (Mở khung đọc / Đóng quảng cáo)',
    selector: '.chapter-content',
    delayMs: 350,
  },
  {
    id: 'step-2',
    label: 'Click 2 (Nút chuyển sang trang tiếp)',
    selector: '.next-chapter-btn',
    delayMs: 850,
  },
];

function extractNextSelectorFromMacro(steps: MacroStep[], fallbackSelector: string): string {
  // Prefer the last step that looks like navigation/next, or the final step selector
  const navStep =
    [...steps]
      .reverse()
      .find((s) => /next|tiếp|sau|chap|trang/i.test(`${s.selector} ${s.label}`)) ||
    steps[steps.length - 1];
  return (navStep?.selector || fallbackSelector || '').trim();
}

export function useWebCrawler(
  onAddBookToLibrary: (book: Book, openImmediately?: boolean) => void
) {
  const [urlInput, setUrlInput] = useState('/demo-web-book/chap-1');
  const [fallbackSelector, setFallbackSelector] = useState('');
  const [macroSteps, setMacroSteps] = useState<MacroStep[]>(DEFAULT_MACRO_STEPS);
  const [pickingStepId, setPickingStepId] = useState<string | null>(null);
  const [maxPages, setMaxPages] = useState(25);

  const [currentPage, setCurrentPage] = useState<ScrapedChapterDraft | null>(null);
  const [scrapedList, setScrapedList] = useState<ScrapedChapterDraft[]>([]);
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatus>('idle');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const [statusMessage, setStatusMessage] = useState('');
  const [issueMessage, setIssueMessage] = useState('');
  const [issueReason, setIssueReason] = useState<WebIssueReason | null>(null);
  const [activeMacroStepLabel, setActiveMacroStepLabel] = useState('');

  const [compiledTitle, setCompiledTitle] = useState('Truyện tổng hợp từ Web');
  const [compiledAuthor, setCompiledAuthor] = useState('Sưu tầm Web');
  const [compiledCollection, setCompiledCollection] = useState('Sưu tầm Web');
  const [compiledStyle, setCompiledStyle] = useState<BookReadingStyle>('novel');

  const runTokenRef = useRef(0);
  const scrapedRef = useRef<ScrapedChapterDraft[]>([]);

  useEffect(() => {
    scrapedRef.current = scrapedList;
  }, [scrapedList]);

  useEffect(() => {
    return () => {
      runTokenRef.current += 1;
    };
  }, []);

  const sleepWithCheck = (ms: number, token: number) =>
    new Promise<boolean>((resolve) => {
      window.setTimeout(() => {
        resolve(runTokenRef.current === token);
      }, Math.max(80, ms));
    });

  const fetchPageData = useCallback(
    async (targetUrl: string, selectorHint?: string): Promise<ScrapedChapterDraft> => {
      const qs = new URLSearchParams({ url: targetUrl.trim() });
      const effectiveSel =
        selectorHint || extractNextSelectorFromMacro(macroSteps, fallbackSelector);
      if (effectiveSel && !effectiveSel.includes('.chapter-content')) {
        qs.set('nextSelector', effectiveSel);
      }

      const resp = await fetch(resolveApiUrl(`/api/web/fetch?${qs.toString()}`));
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || `Lỗi HTTP ${resp.status} khi tải trang web.`);
      }

      // Resolve nextUrl from macro interactive target if matched specifically
      let resolvedNextUrl: string | null = data.nextUrl || null;
      let resolvedNextLabel: string | null = data.nextLabel || null;

      const navStep =
        [...macroSteps]
          .reverse()
          .find((s) => s.selector.trim() && s.selector.trim() !== '.chapter-content');
      if (navStep && Array.isArray(data.interactiveLinks)) {
        const matchedTarget = (
          data.interactiveLinks as Array<{ label: string; selector: string; href: string | null }>
        ).find(
          (item) =>
            item.href &&
            (item.selector === navStep.selector.trim() ||
              navStep.selector.includes(item.selector))
        );
        if (matchedTarget?.href) {
          resolvedNextUrl = matchedTarget.href;
          resolvedNextLabel = matchedTarget.label || resolvedNextLabel;
        }
      }

      return {
        id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        url: data.url || targetUrl,
        title: data.title || 'Chương không tên',
        paragraphs: Array.isArray(data.paragraphs) ? data.paragraphs : [],
        wordCount: Number(data.wordCount || 0),
        nextUrl: resolvedNextUrl,
        nextLabel: resolvedNextLabel,
        interactiveLinks: Array.isArray(data.interactiveLinks) ? data.interactiveLinks : [],
        paywallHint: data.paywallHint || '',
        scrapedAt: Date.now(),
      };
    },
    [macroSteps, fallbackSelector]
  );

  const openUrlDirectly = useCallback(
    async (targetUrl: string, recordIfClean = true): Promise<ScrapedChapterDraft | null> => {
      setIssueMessage('');
      setIssueReason(null);
      setIsFetching(true);
      try {
        const draft = await fetchPageData(targetUrl);
        setCurrentPage(draft);
        setUrlInput(draft.url);

        const issue = detectPaywallOrIssue(
          draft.title,
          draft.paragraphs,
          draft.paywallHint || ''
        );
        if (issue.hasIssue) {
          setIssueReason(issue.reason);
          setIssueMessage(issue.message);
          setCrawlStatus('issue');
          return draft;
        }

        if (recordIfClean) {
          setScrapedList((prev) => {
            const dup = detectDuplicateOrLoop(draft.url, draft.title, draft.paragraphs, prev);
            if (dup.isDuplicate) return prev;
            const next = [...prev, draft];
            scrapedRef.current = next;
            return next;
          });
        }
        return draft;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Lỗi kết nối trang web.';
        setIssueReason('error');
        setIssueMessage(msg);
        return null;
      } finally {
        setIsFetching(false);
      }
    },
    [fetchPageData]
  );

  const runCrawlerLoop = useCallback(
    async (startUrl: string, resetExisting: boolean) => {
      const token = ++runTokenRef.current;
      setIssueMessage('');
      setIssueReason(null);
      setCrawlStatus('running');
      setIsMinimized(true);

      let workingList = resetExisting ? [] : [...scrapedRef.current];
      if (resetExisting) {
        setScrapedList([]);
        scrapedRef.current = [];
      }

      try {
        let nextTargetUrl: string | null = startUrl.trim();
        let stepsCount = 0;

        while (runTokenRef.current === token && nextTargetUrl && stepsCount < maxPages) {
          stepsCount += 1;
          setStatusMessage(`Đang quét trang ${stepsCount}: ${nextTargetUrl}`);
          setIsFetching(true);
          let pageDraft: ScrapedChapterDraft;
          try {
            pageDraft = await fetchPageData(nextTargetUrl);
          } catch (err) {
            if (runTokenRef.current !== token) return;
            setIsFetching(false);
            setCrawlStatus('issue');
            setIsMinimized(false);
            setIssueReason('error');
            setIssueMessage(
              `${err instanceof Error ? err.message : 'Lỗi tải trang.'} Bạn có thể lưu các trang trước hoặc sửa URL rồi nhấn Bắt đầu tiếp.`
            );
            setStatusMessage('Tạm dừng do lỗi tải trang.');
            return;
          }
          setIsFetching(false);
          if (runTokenRef.current !== token) return;

          setCurrentPage(pageDraft);
          setUrlInput(pageDraft.url);

          // Check paywall or missing/empty content
          const issueCheck = detectPaywallOrIssue(
            pageDraft.title,
            pageDraft.paragraphs,
            pageDraft.paywallHint || ''
          );
          if (issueCheck.hasIssue) {
            setCrawlStatus('issue');
            setIsMinimized(false);
            setIssueReason(issueCheck.reason);
            setIssueMessage(issueCheck.message);
            setStatusMessage(`Phát hiện vấn đề tại "${pageDraft.title}" — chờ xử lý.`);
            return;
          }

          // Check duplicate or loop back to page 1
          const dupCheck = detectDuplicateOrLoop(
            pageDraft.url,
            pageDraft.title,
            pageDraft.paragraphs,
            workingList
          );
          const isRescanningStartingPage =
            stepsCount === 1 &&
            workingList.length > 0 &&
            workingList[workingList.length - 1].url.replace(/\/+$/, '') ===
              pageDraft.url.replace(/\/+$/, '');

          if (dupCheck.isDuplicate && !isRescanningStartingPage) {
            setCrawlStatus('completed');
            setIssueReason(dupCheck.isLoopToStart ? 'duplicate_loop' : 'end_of_book');
            setStatusMessage(
              `${dupCheck.message} Đã tổng hợp ${workingList.length} trang, sẵn sàng đặt tên & xuất EPUB.`
            );
            return;
          }

          // Clean new chapter (or re-scanned current starting chapter)
          if (!isRescanningStartingPage) {
            workingList = [...workingList, pageDraft];
            scrapedRef.current = workingList;
            setScrapedList(workingList);
          }

          // Check if no next page link exists
          if (!pageDraft.nextUrl) {
            setCrawlStatus('completed');
            setIssueReason('end_of_book');
            setStatusMessage(
              `Đã quét đến trang cuối cùng (hết trang mới). Tổng cộng ${workingList.length} chương sẵn sàng lưu EPUB!`
            );
            return;
          }

          // Execute configured AutoClick Macro steps with millisecond delays
          for (let mIdx = 0; mIdx < macroSteps.length; mIdx += 1) {
            const step = macroSteps[mIdx];
            setActiveMacroStepLabel(
              `Macro ${mIdx + 1}/${macroSteps.length}: ${step.label} (${step.delayMs}ms)`
            );
            setStatusMessage(
              `Đang chạy ngầm · Đã quét ${workingList.length} trang · Chờ ${step.delayMs}ms (${step.label})`
            );
            const stillRunning = await sleepWithCheck(step.delayMs, token);
            if (!stillRunning) return;
          }

          setActiveMacroStepLabel('');
          nextTargetUrl = pageDraft.nextUrl;
        }

        if (runTokenRef.current === token && stepsCount >= maxPages) {
          setCrawlStatus('completed');
          setStatusMessage(
            `Đã quét đủ giới hạn ${maxPages} trang. Sẵn sàng đặt tên sách và trích xuất EPUB.`
          );
        }
      } finally {
        setIsFetching(false);
        setActiveMacroStepLabel('');
      }
    },
    [fetchPageData, macroSteps, maxPages]
  );

  const setAndStartBackgroundCrawl = useCallback(() => {
    const start = urlInput.trim();
    if (!start) return;
    runCrawlerLoop(start, false);
  }, [urlInput, runCrawlerLoop]);

  const startFreshBackgroundCrawl = useCallback(() => {
    const start = urlInput.trim();
    if (!start) return;
    runCrawlerLoop(start, true);
  }, [urlInput, runCrawlerLoop]);

  const resumeAfterIssue = useCallback(() => {
    const fixedUrl = urlInput.trim();
    if (!fixedUrl) return;
    runCrawlerLoop(fixedUrl, false);
  }, [urlInput, runCrawlerLoop]);

  const togglePause = useCallback(() => {
    if (crawlStatus === 'running') {
      runTokenRef.current += 1;
      setCrawlStatus('paused');
      setStatusMessage(
        `Đã tạm dừng quét ngầm (${scrapedRef.current.length} trang đã lưu).`
      );
      return;
    }
    if (crawlStatus === 'paused') {
      const resumeUrl =
        currentPage?.nextUrl || urlInput.trim() || scrapedRef.current[0]?.url;
      if (resumeUrl) {
        runCrawlerLoop(resumeUrl, false);
      }
    }
  }, [crawlStatus, currentPage, urlInput, runCrawlerLoop]);

  const stopAndResetStatus = useCallback(() => {
    runTokenRef.current += 1;
    setCrawlStatus('idle');
    setIsMinimized(false);
    setIssueMessage('');
    setIssueReason(null);
    setStatusMessage('Đã dừng trình quét Auto-Click.');
  }, []);

  const addMacroStep = () => {
    setMacroSteps((prev) => [
      ...prev,
      {
        id: `step-${Date.now()}`,
        label: `Click ${prev.length + 1}`,
        selector: '.next-chapter-btn',
        delayMs: 600,
      },
    ]);
  };

  const updateMacroStep = (id: string, patch: Partial<MacroStep>) => {
    setMacroSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeMacroStep = (id: string) => {
    setMacroSteps((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  };

  const applyInteractiveTargetToStep = (
    target: { label: string; selector: string; href: string | null }
  ) => {
    if (!pickingStepId) return;
    setMacroSteps((prev) =>
      prev.map((s) =>
        s.id === pickingStepId
          ? {
              ...s,
              selector: target.selector,
              label: `${s.label.split('(')[0].trim()} (${target.label})`,
            }
          : s
      )
    );
    setPickingStepId(null);
  };

  const buildBookFromScraped = useCallback(
    (overrideTitle?: string, overrideCollection?: string): Book => {
      const chapters: Chapter[] = scrapedList.map((item, idx) => ({
        id: `web-ch-${idx + 1}`,
        index: idx,
        title: item.title,
        paragraphs: item.paragraphs,
        sourceUrl: item.url,
      }));

      const title = (overrideTitle ?? compiledTitle).trim() || 'Sách tổng hợp từ Web';
      const author = compiledAuthor.trim() || 'Sưu tầm Web';
      const collection = (overrideCollection ?? compiledCollection).trim() || 'Sưu tầm Web';

      return {
        id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        author,
        description: `Tổng hợp ${chapters.length} trang/chương đã quét tự động từ Web.`,
        language: 'vi',
        sourceType: 'web',
        collection,
        readingStyle: compiledStyle,
        fingerprint: computeBookFingerprint({ title, author, chapters }),
        chapters,
        currentChapterIndex: 0,
        currentParagraphIndex: 0,
        progressPercent: 1,
        bookmarks: [],
        highlights: [],
        voiceAssignments: {},
        addedAt: Date.now(),
        lastReadAt: Date.now(),
        sourceUrl: scrapedList[0]?.url,
      };
    },
    [scrapedList, compiledTitle, compiledAuthor, compiledCollection, compiledStyle]
  );

  const saveScrapedToLibrary = useCallback(
    (overrideTitle?: string, overrideCollection?: string, openImmediately = true) => {
      if (scrapedList.length === 0) {
        setIssueMessage('Chưa có chương nào được quét để lưu vào thư viện.');
        return;
      }
      const book = buildBookFromScraped(overrideTitle, overrideCollection);
      onAddBookToLibrary(book, openImmediately);
      setStatusMessage(
        `Đã lưu "${book.title}" vào Thư viện / Bộ sưu tập (${book.collection})!`
      );
    },
    [scrapedList.length, buildBookFromScraped, onAddBookToLibrary]
  );

  const exportScrapedEpub = useCallback(
    async (overrideTitle?: string) => {
      if (scrapedList.length === 0) {
        setIssueMessage('Chưa có chương nào để trích xuất file .EPUB.');
        return;
      }
      const book = buildBookFromScraped(overrideTitle);
      const blob = await buildEpubBlob(book);
      downloadBlob(blob, `${slugifyFilename(book.title)}.epub`);
      setStatusMessage(`Đã trích xuất tệp ${slugifyFilename(book.title)}.epub thành công!`);
    },
    [scrapedList.length, buildBookFromScraped]
  );

  return {
    urlInput,
    setUrlInput,
    fallbackSelector,
    setFallbackSelector,
    macroSteps,
    addMacroStep,
    updateMacroStep,
    removeMacroStep,
    pickingStepId,
    setPickingStepId,
    applyInteractiveTargetToStep,
    maxPages,
    setMaxPages,
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
    startFreshBackgroundCrawl,
    resumeAfterIssue,
    togglePause,
    stopAndResetStatus,
    saveScrapedToLibrary,
    exportScrapedEpub,
  };
}

export type WebCrawlerController = ReturnType<typeof useWebCrawler>;
