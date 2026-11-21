import { useCallback, useEffect, useRef, useState } from 'react';
import type { Book, BookReadingStyle, Chapter, ScrapedChapterDraft } from '../types/book';
import { buildEpubBlob } from '../utils/epubBuilder';
import { downloadBlob, slugifyFilename } from '../utils/fileHelpers';
import { resolveApiUrl } from '../utils/apiClient';
import { computeBookFingerprint } from '../utils/syncAndStats';
import {
  type CrawlStatus,
  type WebIssueReason,
  detectDuplicateOrLoop,
  detectPaywallOrIssue,
} from '../utils/webCrawlerEngine';
import { extractWebChapterClientSide } from '../utils/deviceHardware';

export function useWebCrawler(
  onAddBookToLibrary: (book: Book, openImmediately?: boolean) => void
) {
  const [urlInput, setUrlInput] = useState('');
  const [maxPages, setMaxPages] = useState(25);
  const [autoSaveAndExportEpub, setAutoSaveAndExportEpub] = useState(true);

  const [currentPage, setCurrentPage] = useState<ScrapedChapterDraft | null>(null);
  const [scrapedList, setScrapedList] = useState<ScrapedChapterDraft[]>([]);
  const [crawlStatus, setCrawlStatus] = useState<CrawlStatus>('idle');
  const [isMinimized, setIsMinimized] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const [statusMessage, setStatusMessage] = useState('');
  const [issueMessage, setIssueMessage] = useState('');
  const [issueReason, setIssueReason] = useState<WebIssueReason | null>(null);
  const [activeScanStepLabel, setActiveScanStepLabel] = useState('');

  const [compiledTitle, setCompiledTitle] = useState('Truyện tổng hợp từ Web');
  const [compiledAuthor, setCompiledAuthor] = useState('Sưu tầm Web');
  const [compiledCollection, setCompiledCollection] = useState('Sưu tầm Web');
  const [compiledStyle, setCompiledStyle] = useState<BookReadingStyle>('novel');

  const runTokenRef = useRef(0);
  const scrapedRef = useRef<ScrapedChapterDraft[]>([]);
  const autoSaveRef = useRef(autoSaveAndExportEpub);

  useEffect(() => {
    autoSaveRef.current = autoSaveAndExportEpub;
  }, [autoSaveAndExportEpub]);

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

  const fetchPageData = useCallback(async (targetUrl: string): Promise<ScrapedChapterDraft> => {
    const rawTrimmed = targetUrl.trim();
    const normalizedUrl =
      rawTrimmed.startsWith('/') || /^https?:\/\//i.test(rawTrimmed)
        ? rawTrimmed
        : rawTrimmed.includes('.') && !rawTrimmed.includes(' ')
          ? `https://${rawTrimmed}`
          : rawTrimmed;
    let data: Record<string, unknown> | null = null;

    // Default AI Auto-Scan: auto-scrolls / locates bottom & right-side next-page controls
    try {
      const aiResp = await fetch(resolveApiUrl('/api/web/ai-scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: normalizedUrl, useAiClean: true }),
      });
      const aiRaw = await aiResp.text();
      if (aiResp.ok) {
        const parsed = JSON.parse(aiRaw) as Record<string, unknown>;
        if (parsed && typeof parsed === 'object') {
          data = parsed;
        }
      }
    } catch {
      // Fall through cleanly to /api/web/fetch
    }

    if (!data) {
      try {
        const qs = new URLSearchParams({ url: normalizedUrl });
        const resp = await fetch(resolveApiUrl(`/api/web/fetch?${qs.toString()}`));
        const rawText = await resp.text();
        let json: Record<string, unknown> = {};
        try {
          json = JSON.parse(rawText) as Record<string, unknown>;
        } catch {
          json = { error: `Máy chủ trả về phản hồi không hợp lệ (HTTP ${resp.status}).` };
        }
        if (!resp.ok) {
          throw new Error(
            String(json?.error || `Lỗi HTTP ${resp.status} khi tải trang web.`)
          );
        }
        data = json;
      } catch (proxyErr) {
        // Standalone phone fallback: attempt direct browser fetch + client-side HTML extraction
        try {
          const directResp = await fetch(normalizedUrl);
          if (!directResp.ok) throw proxyErr;
          const rawHtml = await directResp.text();
          const extracted = extractWebChapterClientSide(rawHtml, normalizedUrl);
          data = {
            url: extracted.url,
            title: extracted.title,
            paragraphs: extracted.paragraphs,
            wordCount: extracted.wordCount,
            nextUrl: extracted.nextUrl,
            nextLabel: extracted.nextLabel,
            interactiveLinks: extracted.interactiveLinks,
            paywallHint: '',
          };
        } catch {
          throw proxyErr;
        }
      }
    }

    const resolvedData: Record<string, unknown> = data;
    return {
      id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url: String(resolvedData.url || normalizedUrl),
      title: String(resolvedData.title || 'Chương không tên'),
      paragraphs: Array.isArray(resolvedData.paragraphs)
        ? (resolvedData.paragraphs as string[])
        : [],
      wordCount: Number(resolvedData.wordCount || 0),
      nextUrl: (resolvedData.nextUrl as string | null) || null,
      nextLabel: (resolvedData.nextLabel as string | null) || null,
      interactiveLinks: Array.isArray(resolvedData.interactiveLinks)
        ? (resolvedData.interactiveLinks as Array<{
            label: string;
            selector: string;
            href: string | null;
          }>)
        : [],
      paywallHint: String(resolvedData.paywallHint || ''),
      scrapedAt: Date.now(),
    };
  }, []);

  const buildBookFromChaptersList = useCallback(
    (
      chaptersList: ScrapedChapterDraft[],
      overrideTitle?: string,
      overrideCollection?: string
    ): Book => {
      const chapters: Chapter[] = chaptersList.map((item, idx) => ({
        id: `web-ch-${idx + 1}`,
        index: idx,
        title: item.title,
        paragraphs: item.paragraphs,
        sourceUrl: item.url,
      }));

      const inferredTitle =
        compiledTitle === 'Truyện tổng hợp từ Web' && chaptersList[0]?.title
          ? chaptersList[0].title.replace(/\s*[-–:]\s*chương\s*\d+.*$/i, '').trim() ||
            compiledTitle
          : compiledTitle;
      const title = (overrideTitle ?? inferredTitle).trim() || 'Sách tổng hợp từ Web';
      const author = compiledAuthor.trim() || 'Sưu tầm Web';
      const collection = (overrideCollection ?? compiledCollection).trim() || 'Sưu tầm Web';

      return {
        id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        author,
        description: `AI tự quét và tổng hợp ${chapters.length} chương sạch từ trang Web đọc sách.`,
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
        sourceUrl: chaptersList[0]?.url,
      };
    },
    [compiledTitle, compiledAuthor, compiledCollection, compiledStyle]
  );

  const triggerAutoSaveAndEpub = useCallback(
    async (chaptersList: ScrapedChapterDraft[], summaryPrefix: string) => {
      if (!autoSaveRef.current || chaptersList.length === 0) {
        setStatusMessage(summaryPrefix);
        return;
      }
      try {
        const book = buildBookFromChaptersList(chaptersList);
        onAddBookToLibrary(book, false);
        const blob = await buildEpubBlob(book);
        const fileName = `${slugifyFilename(book.title)}.epub`;
        downloadBlob(blob, fileName);
        setStatusMessage(
          `${summaryPrefix} Đã tự động lưu "${book.title}" vào Thư viện & tải file ${fileName}!`
        );
      } catch {
        setStatusMessage(`${summaryPrefix} Sẵn sàng nhấn "Trích xuất .EPUB".`);
      }
    },
    [buildBookFromChaptersList, onAddBookToLibrary]
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
        setCrawlStatus('issue');
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
          setStatusMessage(`AI đang quét trang ${stepsCount}: ${nextTargetUrl}`);
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
              `${err instanceof Error ? err.message : 'Lỗi tải trang.'} Bạn có thể đóng thông báo (X) để tự kiểm tra trên trình duyệt gốc hoặc lưu các chương đã quét.`
            );
            setStatusMessage('Tạm dừng do lỗi tải trang.');
            return;
          }
          setIsFetching(false);
          if (runTokenRef.current !== token) return;

          setCurrentPage(pageDraft);
          setUrlInput(pageDraft.url);

          // Detect paywall / login / captcha / empty page
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
            setStatusMessage(`Phát hiện rào cản tại "${pageDraft.title}" — chờ kiểm tra.`);
            return;
          }

          // Detect duplicate or loop back to chapter 1
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
            await triggerAutoSaveAndEpub(
              workingList,
              `${dupCheck.message} Tổng hợp ${workingList.length} chương.`
            );
            return;
          }

          if (!isRescanningStartingPage) {
            workingList = [...workingList, pageDraft];
            scrapedRef.current = workingList;
            setScrapedList(workingList);
          }

          if (!pageDraft.nextUrl) {
            setCrawlStatus('completed');
            setIssueReason('end_of_book');
            await triggerAutoSaveAndEpub(
              workingList,
              `AI đã quét xong ${workingList.length} chương đến trang cuối cùng.`
            );
            return;
          }

          // Polite AI auto-turn pause (handles bottom & right-side next-page links)
          setActiveScanStepLabel(
            `AI tự lướt tìm nút sang trang "${pageDraft.nextLabel || 'Trang tiếp'}"`
          );
          setStatusMessage(
            `AI đang quét trang ${workingList.length} · Tự lướt tìm nút sang trang tiếp theo...`
          );
          const stillRunning = await sleepWithCheck(350, token);
          if (!stillRunning) return;

          setActiveScanStepLabel('');
          nextTargetUrl = pageDraft.nextUrl;
        }

        if (runTokenRef.current === token && stepsCount >= maxPages) {
          setCrawlStatus('completed');
          await triggerAutoSaveAndEpub(
            workingList,
            `Đã quét đủ ${workingList.length} chương theo giới hạn.`
          );
        }
      } finally {
        setIsFetching(false);
        setActiveScanStepLabel('');
      }
    },
    [fetchPageData, maxPages, triggerAutoSaveAndEpub]
  );

  const startAiAutoScanAndSave = useCallback(
    (overrideStartUrl?: string) => {
      const start = (typeof overrideStartUrl === 'string' ? overrideStartUrl : urlInput).trim();
      if (!start) return;
      if (typeof overrideStartUrl === 'string' && overrideStartUrl.trim()) {
        setUrlInput(start);
      }
      runCrawlerLoop(start, true);
    },
    [urlInput, runCrawlerLoop]
  );

  const resumeAfterIssue = useCallback(() => {
    const fixedUrl = urlInput.trim();
    if (!fixedUrl) return;
    runCrawlerLoop(fixedUrl, false);
  }, [urlInput, runCrawlerLoop]);

  const dismissIssueAlert = useCallback(() => {
    setIssueMessage('');
    setIssueReason(null);
    setCrawlStatus((prev) =>
      prev === 'issue' ? (scrapedRef.current.length > 0 ? 'paused' : 'idle') : prev
    );
  }, []);

  const togglePause = useCallback(() => {
    if (crawlStatus === 'running') {
      runTokenRef.current += 1;
      setCrawlStatus('paused');
      setStatusMessage(
        `Đã tạm dừng quét AI (${scrapedRef.current.length} chương đã lưu).`
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
    setStatusMessage('Đã dừng trình quét AI.');
  }, []);

  const buildBookFromScraped = useCallback(
    (overrideTitle?: string, overrideCollection?: string): Book => {
      return buildBookFromChaptersList(scrapedList, overrideTitle, overrideCollection);
    },
    [scrapedList, buildBookFromChaptersList]
  );

  const saveScrapedToLibrary = useCallback(
    (overrideTitle?: string, overrideCollection?: string, openImmediately = true) => {
      if (scrapedList.length === 0) {
        setIssueReason('empty');
        setIssueMessage('Chưa có chương nào được quét để lưu vào thư viện.');
        setCrawlStatus('issue');
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
        setIssueReason('empty');
        setIssueMessage('Chưa có chương nào để trích xuất file .EPUB.');
        setCrawlStatus('issue');
        return;
      }
      const book = buildBookFromScraped(overrideTitle);
      const blob = await buildEpubBlob(book);
      downloadBlob(blob, `${slugifyFilename(book.title)}.epub`);
      setStatusMessage(`Đã trích xuất tệp ${slugifyFilename(book.title)}.epub thành công!`);
    },
    [scrapedList.length, buildBookFromScraped]
  );

  const addChapterFromRawText = useCallback((rawHtmlOrText: string, sourceUrl = '') => {
    const extracted = extractWebChapterClientSide(rawHtmlOrText, sourceUrl);
    if (extracted.paragraphs.length === 0) return null;
    const draft: ScrapedChapterDraft = {
      id: `web-local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      url: extracted.url || `local://chapter-${Date.now()}`,
      title: extracted.title,
      paragraphs: extracted.paragraphs,
      wordCount: extracted.wordCount,
      nextUrl: extracted.nextUrl,
      nextLabel: extracted.nextLabel,
      interactiveLinks: extracted.interactiveLinks,
      paywallHint: '',
      scrapedAt: Date.now(),
    };
    setCurrentPage(draft);
    setScrapedList((prev) => {
      const next = [...prev, draft];
      scrapedRef.current = next;
      return next;
    });
    setStatusMessage(
      `Đã trích xuất trực tiếp "${draft.title}" trên thiết bị (${draft.wordCount} từ).`
    );
    return draft;
  }, []);

  return {
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
    addChapterFromRawText,
  };
}

export type WebCrawlerController = ReturnType<typeof useWebCrawler>;
