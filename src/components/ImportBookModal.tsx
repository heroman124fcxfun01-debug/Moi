import React, { useState, useRef } from 'react';
import {
  X,
  Upload,
  FileText,
  Image as ImageIcon,
  BookOpen,
  Download,
  Loader2,
  Camera,
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

interface ImportBookModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportBook: (book: Book, openImmediately?: boolean) => void;
  defaultReadingStyle?: BookReadingStyle;
  standaloneDeviceMode?: boolean;
}

type ImportTab = 'file' | 'image' | 'text';

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

  // Image OCR + Translation state
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imageMode, setImageMode] = useState<TranslationMode>('bilingual');
  const [imageTargetLang, setImageTargetLang] = useState('vi');
  const [imageBookTitle, setImageBookTitle] = useState('');

  // Raw text import state
  const [textTitle, setTextTitle] = useState('');
  const [textAuthor, setTextAuthor] = useState('');
  const [rawTextContent, setRawTextContent] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleEpubOrPdfFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMessage('');
    setIsBusy(true);

    try {
      for (const file of Array.from(files)) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith('.epub')) {
          setStatusMessage(`Đang giải mã tệp EPUB "${file.name}"...`);
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
          onImportBook(newBook, true);
          onClose();
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
          if (autoExportPdfToEpub) {
            setStatusMessage(`Đã đọc ${pageCount} trang. Đang tạo file .EPUB chuyển đổi...`);
            const epubBlob = await buildEpubBlob(newBook);
            downloadBlob(epubBlob, `${slugifyFilename(newBook.title)}.epub`);
          }
          onImportBook(newBook, true);
          onClose();
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
          onImportBook(newBook, true);
          onClose();
          return;
        }

        setErrorMessage('Vui lòng chọn tệp .epub, .pdf hoặc .txt/.md.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Không thể xử lý tệp đã chọn.');
    } finally {
      setIsBusy(false);
      setStatusMessage('');
    }
  };

  const handleImportImages = async () => {
    if (imageFiles.length === 0) {
      setErrorMessage('Vui lòng chọn ít nhất 1 ảnh trang sách để nhận dạng và dịch.');
      return;
    }

    setErrorMessage('');
    setIsBusy(true);

    try {
      const chapters: Chapter[] = [];
      let detectedTitle = imageBookTitle.trim();

      for (let i = 0; i < imageFiles.length; i++) {
        const file = imageFiles[i];
        setStatusMessage(`Đang quét chữ & dịch ảnh ${i + 1}/${imageFiles.length} (${file.name})...`);
        const dataUrl = await readFileAsDataUrl(file);
        const [prefix, b64] = dataUrl.split(',');
        const mimeMatch = prefix.match(/data:(.*?);/);
        const mimeType = mimeMatch?.[1] || file.type || 'image/png';

        let origParas: string[] = [];
        let transParas: string[] = [];
        let pageDetectedTitle = '';

        // Try on-device hardware TextDetector first when in standalone phone mode
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
              throw new Error(data.error || 'Lỗi dịch trang ảnh từ máy chủ AI.');
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
          paragraphs: finalParagraphs.length > 0 ? finalParagraphs : ['(Không nhận dạng được chữ trên ảnh)'],
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
      const title = detectedTitle || `Sách dịch từ ảnh (${imageFiles.length} trang)`;
      const author = 'Dịch trực tiếp AI';
      const newBook: Book = {
        id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        author,
        description: `Tổng hợp và dịch ${imageFiles.length} trang ảnh (${imageMode === 'bilingual' ? 'Song ngữ' : imageMode === 'override' ? 'Dịch ghi đè' : 'Nguyên bản'}).`,
        language: imageMode === 'override' ? imageTargetLang : 'auto',
        sourceType: 'image',
        collection: collectionInput.trim() || 'Sách dịch từ ảnh',
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

      onImportBook(newBook, true);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Lỗi xử lý ảnh.');
    } finally {
      setIsBusy(false);
      setStatusMessage('');
    }
  };

  const handleCreateTextBook = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!textTitle.trim() || !rawTextContent.trim()) {
      setErrorMessage('Vui lòng nhập tiêu đề và nội dung sách.');
      return;
    }

    const paras = cleanExtractedParagraphs(rawTextContent);
    const title = textTitle.trim();
    const author = textAuthor.trim() || 'Tác giả tự do';
    const chapters = [
      {
        id: 'ch-1',
        index: 0,
        title: 'Chương 1',
        paragraphs: paras,
      },
    ];
    const newBook: Book = {
      id: `book-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      author,
      description: 'Tạo trực tiếp từ trình soạn thảo văn bản LaziRead.',
      language: 'vi',
      sourceType: 'epub',
      collection: collectionInput.trim() || 'Sách tự soạn',
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

    onImportBook(newBook, true);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-stone-950/55 backdrop-blur-md p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="ios-sheet-enter w-full max-w-2xl bg-[#FBF9F5]/95 dark:bg-[#191B1F]/95 backdrop-blur-xl text-stone-900 dark:text-stone-100 border border-stone-200/80 dark:border-stone-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        <div className="sm:hidden flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-stone-300 dark:bg-stone-700" />
        </div>
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200/80 dark:border-stone-800">
          <div>
            <h2 id="import-modal-title" className="text-xl font-display font-semibold">
              Thêm sách mới vào tủ
            </h2>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
              Hỗ trợ EPUB, PDF tự chuyển sang EPUB, hoặc quét dịch trực tiếp từ ảnh trang sách
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại thêm sách"
            className="p-2 rounded-full text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 bg-stone-200/60 dark:bg-stone-800/80 transition-transform active:scale-90"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Tabs */}
        <div className="px-6 pt-4">
          <div className="inline-flex p-1 bg-stone-200/70 dark:bg-stone-800/80 rounded-lg gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('file')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === 'file'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
            >
              EPUB / PDF → EPUB
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('image')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === 'image'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
            >
              Quét & Dịch Ảnh Sách
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('text')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                activeTab === 'text'
                  ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                  : 'text-stone-600 dark:text-stone-400 hover:text-stone-900'
              }`}
            >
              Dán văn bản
            </button>
          </div>
        </div>

        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pb-3 border-b border-stone-200 dark:border-stone-800">
            <div>
              <label className="block text-[11px] font-medium text-stone-500 mb-1">
                Văn phong đọc & AI (chọn trước khi mở)
              </label>
              <select
                value={selectedStyle}
                onChange={(e) => setSelectedStyle(e.target.value as BookReadingStyle)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
              >
                <option value="novel">Tiểu thuyết (Diễn cảm nhiều nhân vật)</option>
                <option value="selfhelp">Văn phong học tập (Nhấn điểm quan trọng)</option>
                <option value="essay">Tản văn (Nhẹ nhàng, truyền cảm hứng)</option>
                <option value="research">Nghiên cứu (Mạch lạc, chuẩn xác)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-stone-500 mb-1">
                Bộ sưu tập chủ đề (tùy chọn)
              </label>
              <input
                type="text"
                value={collectionInput}
                onChange={(e) => setCollectionInput(e.target.value)}
                placeholder="VD: Văn học Việt Nam, Kỹ năng sống..."
                className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
              />
            </div>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          {isBusy && (
            <div className="flex items-center gap-3 p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs text-amber-900 dark:text-amber-200">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>{statusMessage || 'Đang xử lý...'}</span>
            </div>
          )}

          {activeTab === 'file' && (
            <div className="space-y-4">
              <label className="flex items-center gap-2.5 text-xs text-stone-700 dark:text-stone-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoExportPdfToEpub}
                  onChange={(e) => setAutoExportPdfToEpub(e.target.checked)}
                  className="rounded border-stone-300 accent-amber-800"
                />
                <span>
                  Khi tải tệp <strong>.PDF</strong>, tự động chuyển đổi và tải xuống bản{' '}
                  <strong>.EPUB</strong> về máy
                </span>
              </label>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  handleEpubOrPdfFiles(e.dataTransfer.files);
                }}
                className="border border-dashed border-stone-300 dark:border-stone-700 rounded-xl p-8 text-center bg-white/60 dark:bg-stone-900/40 hover:border-amber-800 transition-colors"
              >
                <Upload className="w-8 h-8 mx-auto text-stone-400 mb-3" />
                <p className="text-sm font-medium text-stone-800 dark:text-stone-200">
                  Kéo thả tệp .EPUB, .PDF hoặc .TXT vào đây
                </p>
                <p className="text-xs text-stone-500 mt-1">
                  Hỗ trợ giữ nguyên mục lục EPUB, ảnh bìa và tự tách chương từ PDF
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
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Chọn tệp từ thiết bị</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'image' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                    Tên sách (tùy chọn)
                  </label>
                  <input
                    type="text"
                    value={imageBookTitle}
                    onChange={(e) => setImageBookTitle(e.target.value)}
                    placeholder="Tự động nhận dạng theo trang đầu"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                    Chế độ hiển thị bản dịch
                  </label>
                  <select
                    value={imageMode}
                    onChange={(e) => setImageMode(e.target.value as TranslationMode)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                  >
                    <option value="bilingual">Song ngữ (Gốc + Dịch đối chiếu)</option>
                    <option value="override">Dịch ghi đè hoàn toàn</option>
                    <option value="original">Chỉ trích xuất văn bản gốc</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                  Ngôn ngữ đích
                </label>
                <select
                  value={imageTargetLang}
                  onChange={(e) => setImageTargetLang(e.target.value)}
                  className="w-full sm:w-1/2 px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                >
                  {TARGET_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="border border-dashed border-stone-300 dark:border-stone-700 rounded-xl p-6 text-center bg-white/60 dark:bg-stone-900/40">
                <ImageIcon className="w-7 h-7 mx-auto text-stone-400 mb-2" />
                <p className="text-xs font-medium text-stone-700 dark:text-stone-300">
                  Chọn 1 hoặc nhiều ảnh trang sách / truyện tranh (.PNG, .JPG, .WEBP)
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
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => cameraInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-700/50 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 text-xs font-medium hover:opacity-90"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Chụp ảnh (Camera)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-lg border border-stone-300 dark:border-stone-700 text-xs font-medium hover:bg-stone-100 dark:hover:bg-stone-800"
                  >
                    Chọn ảnh ({imageFiles.length})
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || imageFiles.length === 0}
                    onClick={handleImportImages}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-800 text-white text-xs font-medium hover:bg-amber-900 disabled:opacity-50"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Quét &amp; Tạo sách</span>
                  </button>
                </div>
                {imageFiles.length > 0 && (
                  <p className="text-[11px] text-stone-500 mt-2 truncate">
                    Đã chọn: {imageFiles.map((f) => f.name).join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'text' && (
            <form onSubmit={handleCreateTextBook} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                    Tên sách *
                  </label>
                  <input
                    type="text"
                    required
                    value={textTitle}
                    onChange={(e) => setTextTitle(e.target.value)}
                    placeholder="Ví dụ: Tuyển tập truyện ngắn"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                    Tác giả
                  </label>
                  <input
                    type="text"
                    value={textAuthor}
                    onChange={(e) => setTextAuthor(e.target.value)}
                    placeholder="Tên tác giả"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 dark:text-stone-400 mb-1">
                  Nội dung sách *
                </label>
                <textarea
                  rows={6}
                  required
                  value={rawTextContent}
                  onChange={(e) => setRawTextContent(e.target.value)}
                  placeholder="Dán nội dung chương truyện hoặc tài liệu tại đây..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 text-xs font-medium"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Lưu thành sách & Đọc ngay</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
