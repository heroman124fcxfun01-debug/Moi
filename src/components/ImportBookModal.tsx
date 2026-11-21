import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  BookOpen,
  Loader2,
  Camera,
  ChevronLeft,
  Video,
} from 'lucide-react';
import type { Book, BookReadingStyle, Chapter, TranslationMode } from '../types/book';
import { parseEpubBuffer, buildEpubBlob } from '../utils/epubBuilder';
import { parsePdfBufferToBook } from '../utils/pdfParser';
import { cleanExtractedParagraphs } from '../utils/textProcessing';
import { computeBookFingerprint } from '../utils/syncAndStats';
import {
  downloadBlob,
  readFileAsArrayBuffer,
  readFileAsDataUrl,
  readFileAsText,
  slugifyFilename,
  TARGET_LANGUAGES,
} from '../utils/fileHelpers';
import { tryOnDeviceHardwareOcr } from '../utils/deviceHardware';
import { tryOnDeviceTranslateParagraphs } from '../utils/languagePacks';
import { resolveApiUrl } from '../utils/apiClient';
import {
  assembleScannedPagesToBook,
  extractDistinctBookFramesFromVideo,
} from '../utils/videoBookScanner';
import {
  applyBookCleanupSelection,
  type BookCleanupReport,
  type CleanupSelection,
} from '../utils/aiContentCleaner';
import { runImportBookAiScan } from '../utils/aiContentCleanerClient';
import { BookCleanupReviewModal } from './BookCleanupReviewModal';
import { GlassSelect } from './GlassSelect';

interface ImportBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportBook: (book: Book, openImmediately?: boolean) => void;
  defaultReadingStyle?: BookReadingStyle;
  standaloneDeviceMode?: boolean;
}

type ImportTab = 'file' | 'image';

const READING_STYLE_OPTIONS: Array<{ value: BookReadingStyle; label: string; subtitle: string }> = [
  { value: 'novel', label: 'Tiểu thuyết', subtitle: 'Diễn cảm đa nhân vật & cảm xúc' },
  { value: 'selfhelp', label: 'Học tập / Self-help', subtitle: 'Rõ ràng, nhấn ý chính' },
  { value: 'essay', label: 'Tản văn', subtitle: 'Nhẹ nhàng, tình cảm' },
  { value: 'research', label: 'Nghiên cứu', subtitle: 'Mạch lạc, chuẩn xác' },
];

const IMAGE_MODE_OPTIONS: Array<{ value: TranslationMode; label: string }> = [
  { value: 'bilingual', label: 'Song ngữ (Gốc + Dịch)' },
  { value: 'override', label: 'Dịch ghi đè hoàn toàn' },
  { value: 'original', label: 'Chỉ trích xuất văn bản gốc' },
];

const TARGET_LANG_OPTIONS = TARGET_LANGUAGES.map((l) => ({
  value: l.code,
  label: l.label,
}));

export const ImportBookModal: React.FC<ImportBookModalProps> = ({
  isOpen,
  onClose,
  onImportBook,
  defaultReadingStyle = 'novel',
  standaloneDeviceMode = true,
}) => {
  const [activeTab, setActiveTab] = useState<ImportTab>('file');
  const [isBusy, setIsBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [autoExportPdfToEpub, setAutoExportPdfToEpub] = useState(true);
  const [selectedStyle, setSelectedStyle] = useState<BookReadingStyle>(defaultReadingStyle);
  const [collectionInput, setCollectionInput] = useState('');

  // Image OCR + Video Book Scanner state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageMode, setImageMode] = useState<TranslationMode>('bilingual');
  const [imageTargetLang, setImageTargetLang] = useState('vi');
  const [imageBookTitle, setImageBookTitle] = useState('');

  // Job 1 AI Cleanup Review state before finalizing imported book
  const [pendingCleanup, setPendingCleanup] = useState<{
    book: Book;
    report: BookCleanupReport;
    exportEpubAfter?: boolean;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const finalizeBookImport = async (finalBook: Book, exportEpub?: boolean) => {
    if (exportEpub) {
      setIsBusy(true);
      setStatusMessage('Đang tạo tệp .EPUB sạch...');
      try {
        const epubBlob = await buildEpubBlob(finalBook);
        downloadBlob(epubBlob, `${slugifyFilename(finalBook.title)}.epub`);
      } finally {
        setIsBusy(false);
        setStatusMessage('');
      }
    }
    setPendingCleanup(null);
    onImportBook(finalBook, true);
    onClose();
  };

  const scanAndConfirmOrImport = async (draftBook: Book, exportEpubAfter = false) => {
    const report = await runImportBookAiScan(draftBook, setStatusMessage);
    if (report.totalIssues > 0) {
      setPendingCleanup({
        book: draftBook,
        report,
        exportEpubAfter,
      });
      return;
    }
    await finalizeBookImport(draftBook, exportEpubAfter);
  };

  const handleEpubOrPdfFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMessage('');
    setIsBusy(true);

    try {
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.epub')) {
          setStatusMessage(`Đang giải mã EPUB "${file.name}"...`);
          const buf = await readFileAsArrayBuffer(file);
          const draft = await parseEpubBuffer(buf, file.name);
          const newBook: Book = {
            ...draft,
            id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            collection: collectionInput.trim() || draft.collection || 'Sách EPUB đã nhập',
            readingStyle: selectedStyle,
            addedAt: Date.now(),
            lastReadAt: Date.now(),
          };
          await scanAndConfirmOrImport(newBook, false);
          return;
        }

        if (lower.endsWith('.pdf')) {
          setStatusMessage(`Đang trích xuất PDF "${file.name}"...`);
          const buf = await readFileAsArrayBuffer(file);
          const { bookDraft, pageCount } = await parsePdfBufferToBook(
            buf,
            file.name,
            (cur, total) => setStatusMessage(`Đang đọc & chuyển trang PDF ${cur}/${total}...`)
          );
          const newBook: Book = {
            ...bookDraft,
            id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            collection: collectionInput.trim() || bookDraft.collection || 'Tài liệu PDF',
            readingStyle: selectedStyle,
            addedAt: Date.now(),
            lastReadAt: Date.now(),
          };
          setStatusMessage(`Đã đọc ${pageCount} trang. AI đang quét làm sạch nội dung...`);
          await scanAndConfirmOrImport(newBook, autoExportPdfToEpub);
          return;
        }

        if (lower.endsWith('.txt') || lower.endsWith('.md')) {
          setStatusMessage(`Đang nhập văn bản "${file.name}"...`);
          const txt = await readFileAsText(file);
          const paras = cleanExtractedParagraphs(txt);
          const title = file.name.replace(/\.(txt|md)$/i, '');
          const author = 'Tệp văn bản';
          const chapters = [
            {
              id: 'ch-1',
              index: 0,
              title: 'Nội dung chính',
              paragraphs: paras.length > 0 ? paras : ['(Không có nội dung)'],
            },
          ];
          const newBook: Book = {
            id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title,
            author,
            description: `Nhập từ tệp ${file.name}`,
            language: 'vi',
            sourceType: 'epub',
            collection: collectionInput.trim() || 'Văn bản đã nhập',
            readingStyle: selectedStyle,
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
          };
          await scanAndConfirmOrImport(newBook, false);
          return;
        }

        setErrorMessage('Vui lòng chọn tệp .epub, .pdf hoặc .txt/.md.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không thể xử lý tệp đã chọn.');
    } finally {
      setIsBusy(false);
      setStatusMessage('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleImportImages = async () => {
    if (imageFiles.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất 1 ảnh trang sách để nhận dạng.');
      return;
    }

    setErrorMessage('');
    setIsBusy(true);

    try {
      const chapters: Chapter[] = [];
      let detectedTitle = imageBookTitle.trim();

      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        setStatusMessage(`Đang quét ảnh ${i + 1}/${imageFiles.length}...`);
        const dataUrl = await readFileAsDataUrl(file);
        const [prefix, b64] = dataUrl.split(',');
        const mimeMatch = prefix.match(/data:(.*?);/);
        const mimeType = mimeMatch?.[1] || file.type || 'image/png';

        let origParas: string[] = [];
        let transParas: string[] = [];
        let pageDetectedTitle = '';

        if (standaloneDeviceMode) {
          const hardwareLines = await tryOnDeviceHardwareOcr(dataUrl);
          if (hardwareLines && hardwareLines.length > 0) {
            origParas = hardwareLines;
            if (imageMode !== 'original') {
              const localTrans = await tryOnDeviceTranslateParagraphs(origParas, imageTargetLang);
              if (localTrans) transParas = localTrans;
            }
          }
        }

        if (origParas.length === 0) {
          try {
            const resp = await fetch(resolveApiUrl('/api/ai/ocr-translate'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                imageBase64: b64,
                mimeType,
                targetLang: imageTargetLang,
                mode: imageMode,
              }),
            });
            const data = await resp.json();
            if (!resp.ok) {
              throw new Error(data.error || 'Lỗi quét trang ảnh từ máy chủ AI.');
            }
            pageDetectedTitle = data.detectedTitle || '';
            origParas = Array.isArray(data.originalParagraphs) ? data.originalParagraphs : [];
            transParas = Array.isArray(data.translatedParagraphs) ? data.translatedParagraphs : [];
          } catch (ocrErr) {
            const fallbackLines = await tryOnDeviceHardwareOcr(dataUrl);
            if (fallbackLines && fallbackLines.length > 0) {
              origParas = fallbackLines;
              if (imageMode !== 'original') {
                const localTrans = await tryOnDeviceTranslateParagraphs(origParas, imageTargetLang);
                if (localTrans) transParas = localTrans;
              }
            } else {
              throw ocrErr;
            }
          }
        }

        if (!detectedTitle && pageDetectedTitle) {
          detectedTitle = pageDetectedTitle;
        }

        const finalParagraphs =
          imageMode === 'override' && transParas.length > 0 ? transParas : origParas;

        chapters.push({
          id: `img-ch-${i + 1}`,
          index: i,
          title:
            imageFiles.length === 1
              ? pageDetectedTitle || 'Trang sách 1'
              : `Trang ${i + 1} · ${file.name.replace(/\.[^.]+$/, '')}`,
          paragraphs:
            finalParagraphs.length > 0 ? finalParagraphs : ['(Không nhận dạng được chữ trên ảnh)'],
          translations:
            transParas.length > 0
              ? {
                  [imageTargetLang]: {
                    targetLang: imageTargetLang,
                    paragraphs: transParas,
                    translatedAt: Date.now(),
                  },
                }
              : undefined,
        });
      }

      const firstCover = await readFileAsDataUrl(imageFiles[0]);
      const title = detectedTitle || `Sách quét từ ảnh (${imageFiles.length} trang)`;
      const author = 'BOOKHAD Scan';
      const newBook: Book = {
        id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        author,
        description: `Tổng hợp ${imageFiles.length} trang ảnh (${
          imageMode === 'bilingual'
            ? 'Song ngữ'
            : imageMode === 'override'
            ? 'Dịch ghi đè'
            : 'Nguyên bản'
        }).`,
        language: imageMode === 'override' ? imageTargetLang : 'auto',
        sourceType: 'image',
        collection: collectionInput.trim() || 'Sách quét từ ảnh',
        readingStyle: selectedStyle,
        fingerprint: computeBookFingerprint({ title, author, chapters }),
        coverUrl: firstCover,
        chapters,
        currentChapterIndex: 0,
        currentParagraphIndex: 0,
        progressPercent: 1,
        bookmarks: [],
        highlights: [],
        voiceAssignments: {},
        addedAt: Date.now(),
        lastReadAt: Date.now(),
      };

      await scanAndConfirmOrImport(newBook, false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi xử lý ảnh.');
    } finally {
      setIsBusy(false);
      setStatusMessage('');
    }
  };

  /**
   * Silent background Video Book Scanner:
   * Samples distinct book pages from a video file (low-RAM 64x64 frame diffing),
   * sends batches silently to /api/ai/scan-book-pages, builds & downloads .EPUB,
   * and imports straight into the BOOKHAD library.
   */
  const handleImportBookVideo = async (files: FileList | null) => {
    const videoFile = files?.[0];
    if (!videoFile) return;

    setErrorMessage('');
    setIsBusy(true);
    setStatusMessage('Đang tách từng trang sách từ video...');

    try {
      const extractedFrames = await extractDistinctBookFramesFromVideo(videoFile, {
        maxFrames: 18,
        onProgress: (pct, kept) => {
          setStatusMessage(`Đang tách trang video (${pct}% · ${kept} trang)...`);
        },
      });

      if (extractedFrames.length === 0) {
        throw new Error('Không tách được khung hình trang sách rõ nét từ video này.');
      }

      const allChapters: Array<{ title: string; paragraphs: string[] }> = [];
      let resolvedTitle = imageBookTitle.trim();
      let resolvedAuthor = '';

      // Process in compact silent batches of 6 frames to keep mobile RAM & payload low
      const batchSize = 6;
      const totalBatches = Math.ceil(extractedFrames.length / batchSize);
      for (let b = 0; b < totalBatches; b++) {
        const batch = extractedFrames.slice(b * batchSize, (b + 1) * batchSize);
        setStatusMessage(
          `Đang số hóa trang sách (${Math.min((b + 1) * batchSize, extractedFrames.length)}/${extractedFrames.length})...`
        );

        const resp = await fetch(resolveApiUrl('/api/ai/scan-book-pages'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            frames: batch.map((f) => ({ base64: f.base64, mimeType: f.mimeType })),
            targetLang: imageTargetLang,
            translateToTarget: imageMode !== 'original',
            hintTitle: resolvedTitle || videoFile.name.replace(/\.[^.]+$/, ''),
          }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          throw new Error(data.error || 'Không thể nhận dạng chữ từ khung hình video.');
        }
        if (!resolvedTitle && data.title) resolvedTitle = String(data.title);
        if (!resolvedAuthor && data.author) resolvedAuthor = String(data.author);
        if (Array.isArray(data.chapters)) {
          for (const ch of data.chapters) {
            allChapters.push({
              title: String(ch?.title || `Phần ${allChapters.length + 1}`),
              paragraphs: Array.isArray(ch?.paragraphs) ? ch.paragraphs.map(String) : [],
            });
          }
        }
      }

      const coverDataUrl = `data:image/jpeg;base64,${extractedFrames[0].base64}`;
      const assembledBook = assembleScannedPagesToBook({
        title: resolvedTitle || videoFile.name.replace(/\.[^.]+$/, '') || 'Sách quét từ video',
        author: resolvedAuthor || 'BOOKHAD Scan',
        collection: collectionInput.trim() || 'Sách quét từ video',
        readingStyle: selectedStyle,
        chapters: allChapters,
        coverDataUrl,
        targetLang: imageTargetLang,
      });

      await scanAndConfirmOrImport(assembledBook, true);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Không thể quét video đọc sách.'
      );
    } finally {
      setIsBusy(false);
      setStatusMessage('');
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[75] flex items-end sm:items-center justify-center ios-frosted-backdrop ios-backdrop-fade p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isBusy) onClose();
      }}
    >
      <div className="ios-sheet-enter ios-frosted-surface w-full max-w-xl text-stone-900 dark:text-stone-100 rounded-t-[24px] sm:rounded-[22px] overflow-hidden max-h-[88dvh] flex flex-col">
        <div className="sm:hidden flex justify-center pt-1.5 pb-0.5 shrink-0">
          <span className="w-9 h-1 rounded-full bg-stone-300 dark:bg-stone-600" />
        </div>

        {/* Compact Header with half-size title */}
        <div className="flex items-center justify-between gap-2 px-3.5 py-2 border-b border-stone-200 dark:border-zinc-800 shrink-0">
          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors shrink-0 disabled:opacity-40"
          >
            <ChevronLeft className="w-3.5 h-3.5 -ml-0.5" />
            <span>Quay lại</span>
          </button>

          <h2
            id="import-modal-title"
            className="text-[10px] sm:text-[11px] font-display font-semibold truncate text-center leading-tight"
          >
            Thêm sách mới
          </h2>

          <button
            type="button"
            disabled={isBusy}
            onClick={onClose}
            aria-label="Đóng hộp thoại thêm sách"
            className="w-6 h-6 rounded-full bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-stone-600 dark:text-stone-300 shrink-0 disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Compact 2-Tab Selector (EPUB/PDF + Quét ảnh) */}
        <div className="px-4 pt-2.5 shrink-0 flex justify-center sm:justify-start">
          <div className="inline-flex items-center p-0.5 rounded-full bg-stone-100 dark:bg-zinc-800 gap-0.5 max-w-full">
            <button
              type="button"
              onClick={() => setActiveTab('file')}
              className={`inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-full whitespace-nowrap transition-colors ${
                activeTab === 'file'
                  ? 'bg-white dark:bg-zinc-950 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
            >
              <FileText className="w-2.5 h-2.5 shrink-0" />
              <span>EPUB / PDF</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('image')}
              className={`inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-full whitespace-nowrap transition-colors ${
                activeTab === 'image'
                  ? 'bg-white dark:bg-zinc-950 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
            >
              <Camera className="w-2.5 h-2.5 shrink-0" />
              <span>Quét ảnh</span>
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5 space-y-3.5 overflow-y-auto overscroll-contain">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pb-3 border-b border-stone-300/40 dark:border-white/10">
            <div>
              <label className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1">
                Phong cách giọng đọc
              </label>
              <GlassSelect
                value={selectedStyle}
                onChange={(v) => setSelectedStyle(v as BookReadingStyle)}
                options={READING_STYLE_OPTIONS}
                title="Chọn phong cách giọng đọc"
                ariaLabel="Chọn phong cách giọng đọc"
                buttonClassName="py-1.5 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1">
                Bộ sưu tập (tùy chọn)
              </label>
              <input
                type="text"
                value={collectionInput}
                onChange={(e) => setCollectionInput(e.target.value)}
                placeholder="VD: Văn học, Kỹ năng..."
                className="w-full px-3 py-1.5 text-[11.5px] rounded-xl border border-stone-300/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-[11.5px] text-red-700 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          {isBusy && (
            <div className="flex items-center gap-2.5 p-3 rounded-xl bg-amber-800/10 border border-amber-700/30 text-[11.5px] text-amber-900 dark:text-amber-200">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{statusMessage || 'Đang xử lý...'}</span>
            </div>
          )}

          {activeTab === 'file' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-[11.5px] text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoExportPdfToEpub}
                  onChange={(e) => setAutoExportPdfToEpub(e.target.checked)}
                  className="rounded border-stone-300 accent-amber-800"
                />
                <span>
                  Tự chuyển <strong>.PDF</strong> sang <strong>.EPUB</strong> &amp; tải về máy
                </span>
              </label>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleEpubOrPdfFiles(e.dataTransfer.files);
                }}
                className="border border-dashed border-stone-400/60 dark:border-white/20 rounded-2xl p-6 text-center bg-white/50 dark:bg-white/[0.04] hover:border-amber-800 transition-colors"
              >
                <Upload className="w-6 h-6 mx-auto text-stone-500 dark:text-stone-400 mb-2" />
                <p className="text-[13px] font-medium text-stone-800 dark:text-stone-200">
                  Chọn hoặc kéo thả tệp .EPUB, .PDF, .TXT
                </p>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  Giữ nguyên mục lục, ảnh bìa và tự tách chương sạch
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".epub,.pdf,.txt,.md"
                  className="hidden"
                  onChange={(e) => handleEpubOrPdfFiles(e.target.files)}
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-3.5 inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11.5px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Chọn tệp từ thiết bị</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'image' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1">
                    Tên sách (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={imageBookTitle}
                    onChange={(e) => setImageBookTitle(e.target.value)}
                    placeholder="Tự nhận dạng theo trang đầu"
                    className="w-full px-3 py-1.5 text-[11.5px] rounded-xl border border-stone-300/70 dark:border-white/15 bg-white/75 dark:bg-zinc-900/70"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1">
                    Chế độ bản dịch
                  </label>
                  <GlassSelect
                    value={imageMode}
                    onChange={(v) => setImageMode(v as TranslationMode)}
                    options={IMAGE_MODE_OPTIONS}
                    title="Chế độ hiển thị bản dịch"
                    ariaLabel="Chế độ hiển thị bản dịch"
                    buttonClassName="py-1.5 rounded-xl"
                  />
                </div>
              </div>

              <div className="sm:w-1/2">
                <label className="block text-[11px] font-medium text-stone-500 dark:text-stone-400 mb-1">
                  Ngôn ngữ đích
                </label>
                <GlassSelect
                  value={imageTargetLang}
                  onChange={(v) => setImageTargetLang(v)}
                  options={TARGET_LANG_OPTIONS}
                  title="Chọn ngôn ngữ đích"
                  ariaLabel="Chọn ngôn ngữ đích"
                  buttonClassName="py-1.5 rounded-xl"
                />
              </div>

              <div className="border border-dashed border-stone-400/60 dark:border-white/20 rounded-2xl p-4 sm:p-5 text-center bg-white/50 dark:bg-white/[0.04] space-y-3">
                <div className="flex items-center justify-center gap-2 text-stone-500 dark:text-stone-400">
                  <ImageIcon className="w-5 h-5" />
                  <Video className="w-5 h-5 text-amber-800 dark:text-amber-400" />
                </div>
                <p className="text-[11.5px] font-medium text-stone-700 dark:text-stone-300">
                  Chụp ảnh, chọn nhiều ảnh hoặc tải Video lật trang sách (AI tự đóng gói .EPUB)
                </p>

                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => setImageFiles(Array.from(e.target.files || []))}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const shot = Array.from(e.target.files || []);
                    if (shot.length > 0) {
                      setImageFiles((prev) => [...prev, ...shot]);
                    }
                  }}
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => handleImportBookVideo(e.target.files)}
                />

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => cameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-amber-700/50 bg-amber-50/80 dark:bg-amber-950/35 text-amber-900 dark:text-amber-200 text-[11px] font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    <Camera className="w-3 h-3" />
                    <span>Chụp ảnh</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => imageInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-stone-300 dark:border-white/20 text-[11px] font-medium hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
                  >
                    <ImageIcon className="w-3 h-3" />
                    <span>Chọn ảnh ({imageFiles.length})</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => videoInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-[11px] font-semibold hover:opacity-90 disabled:opacity-50"
                  >
                    <Video className="w-3 h-3" />
                    <span>Video đọc sách</span>
                  </button>
                </div>

                {imageFiles.length > 0 && (
                  <div className="pt-1 space-y-2">
                    <p className="text-[10.5px] text-stone-500 truncate">
                      Đã chọn: {imageFiles.map((f) => f.name).join(', ')}
                    </p>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={handleImportImages}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-amber-800 text-white text-[11.5px] font-semibold hover:bg-amber-900 disabled:opacity-50"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Quét &amp; Tạo sách</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {pendingCleanup && (
        <BookCleanupReviewModal
          isOpen
          bookTitle={pendingCleanup.book.title}
          report={pendingCleanup.report}
          confirmLabel="Áp dụng & Lưu"
          keepOriginalLabel="Giữ nguyên"
          onKeepOriginal={() => {
            void finalizeBookImport(pendingCleanup.book, pendingCleanup.exportEpubAfter);
          }}
          onConfirm={(selection: CleanupSelection) => {
            const { cleanedBook } = applyBookCleanupSelection(
              pendingCleanup.book,
              pendingCleanup.report,
              selection
            );
            void finalizeBookImport(cleanedBook, pendingCleanup.exportEpubAfter);
          }}
        />
      )}
    </div>
  );
};
