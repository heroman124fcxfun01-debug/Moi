import type { Book, Chapter } from '../types/book';
import { computeBookFingerprint } from './syncAndStats';

export interface ExtractedVideoPageFrame {
  base64: string;
  mimeType: 'image/jpeg';
  timestampSec: number;
}

export interface ScannedBookPayload {
  title?: string;
  author?: string;
  collection?: string;
  readingStyle?: Book['readingStyle'];
  chapters: Array<{
    title: string;
    paragraphs: string[];
  }>;
  coverDataUrl?: string;
  targetLang?: string;
}

/**
 * Computes mean normalized grayscale luma delta in [0, 1] between two equal-sized frame buffers.
 * Pure & allocation-free so it stays ultra-fast even on budget phones.
 */
export function computeFrameDifferenceScore(
  prevLuma: Uint8Array,
  nextLuma: Uint8Array
): number {
  const len = Math.min(prevLuma.length, nextLuma.length);
  if (len === 0) return 1;
  let totalDiff = 0;
  for (let i = 0; i < len; i++) {
    totalDiff += Math.abs(prevLuma[i] - nextLuma[i]);
  }
  return totalDiff / (len * 255);
}

/**
 * Decides whether a sampled video frame represents a distinct, legible book page.
 * Filters out static duplicates and pitch-black / completely overexposed frames.
 */
export function shouldKeepCandidateFrame(
  diffScore: number,
  brightnessMean: number,
  threshold = 0.055
): boolean {
  if (brightnessMean < 18 || brightnessMean > 250) return false;
  return diffScore >= threshold;
}

/**
 * Assembles AI-scanned chapters from book photos or video pages into a clean BOOKHAD Book
 * ready for immediate reading and `.epub` export.
 */
export function assembleScannedPagesToBook(payload: ScannedBookPayload): Book {
  const rawChapters = Array.isArray(payload.chapters) ? payload.chapters : [];
  const cleanedChapters: Chapter[] = rawChapters
    .map((ch, idx) => {
      const paragraphs = (Array.isArray(ch.paragraphs) ? ch.paragraphs : [])
        .map((p) => String(p || '').replace(/\s+/g, ' ').trim())
        .filter((p) => p.length > 0);
      return {
        id: `scan-ch-${idx + 1}`,
        index: idx,
        title: (ch.title || '').trim() || `Chương ${idx + 1}`,
        paragraphs,
      };
    })
    .filter((ch) => ch.paragraphs.length > 0)
    .map((ch, idx) => ({ ...ch, index: idx }));

  if (cleanedChapters.length === 0) {
    cleanedChapters.push({
      id: 'scan-ch-1',
      index: 0,
      title: 'Trang đã quét',
      paragraphs: ['Không nhận dạng được đoạn văn bản rõ nét từ video/ảnh sách.'],
    });
  }

  const now = Date.now();
  const safeTitle = (payload.title || '').trim() || 'Sách quét từ video';
  const safeAuthor = (payload.author || '').trim() || 'BOOKHAD Scan';

  return {
    id: `book-vscan-${now}-${Math.random().toString(36).slice(2, 6)}`,
    title: safeTitle,
    author: safeAuthor,
    language: payload.targetLang || 'vi',
    sourceType: 'epub',
    collection: (payload.collection || '').trim() || 'Sách quét từ video',
    readingStyle: payload.readingStyle || 'novel',
    fingerprint: computeBookFingerprint({
      title: safeTitle,
      author: safeAuthor,
      chapters: cleanedChapters,
    }),
    coverUrl: payload.coverDataUrl || '',
    description: `Số hóa tự động từ video đọc sách (${cleanedChapters.length} chương).`,
    chapters: cleanedChapters,
    progressPercent: 1,
    currentChapterIndex: 0,
    currentParagraphIndex: 0,
    bookmarks: [],
    highlights: [],
    voiceAssignments: {},
    addedAt: now,
    lastReadAt: now,
  };
}

/**
 * Samples distinct book pages from a user-selected video file using a tiny 64x64 luma
 * comparison buffer to minimize RAM and thermal usage, then encodes only distinct pages
 * as compact JPEG frames for silent AI OCR → EPUB conversion.
 */
export async function extractDistinctBookFramesFromVideo(
  file: File,
  options?: {
    maxFrames?: number;
    sampleIntervalSec?: number;
    diffThreshold?: number;
    onProgress?: (percent: number, keptCount: number) => void;
  }
): Promise<ExtractedVideoPageFrame[]> {
  const maxFrames = options?.maxFrames ?? 18;
  const diffThreshold = options?.diffThreshold ?? 0.055;
  const objectUrl = URL.createObjectURL(file);

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Không thể đọc tệp video này. Vui lòng thử định dạng MP4/MOV/WebM.'));
      };
      const cleanup = () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const rawInterval = options?.sampleIntervalSec ?? Math.max(0.7, duration / 28);
    const stepSec = Math.max(0.5, Math.min(rawInterval, 3.5));

    const lumaW = 64;
    const lumaH = 64;
    const lumaCanvas = document.createElement('canvas');
    lumaCanvas.width = lumaW;
    lumaCanvas.height = lumaH;
    const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });

    const naturalW = video.videoWidth || 1080;
    const naturalH = video.videoHeight || 1920;
    const scale = Math.min(1, 1120 / Math.max(naturalW, naturalH));
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = Math.max(1, Math.round(naturalW * scale));
    captureCanvas.height = Math.max(1, Math.round(naturalH * scale));
    const captureCtx = captureCanvas.getContext('2d');

    if (!lumaCtx || !captureCtx) {
      throw new Error('Trình duyệt không hỗ trợ xử lý khung hình video.');
    }

    const timestamps: number[] = [];
    for (let t = Math.min(0.25, duration * 0.05); t < duration; t += stepSec) {
      timestamps.push(Math.min(t, Math.max(0, duration - 0.05)));
    }
    if (timestamps.length === 0) timestamps.push(0);

    const frames: ExtractedVideoPageFrame[] = [];
    let prevLuma: Uint8Array | null = null;

    for (let i = 0; i < timestamps.length && frames.length < maxFrames; i++) {
      const ts = timestamps[i];
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = ts;
      });

      lumaCtx.drawImage(video, 0, 0, lumaW, lumaH);
      const imgData = lumaCtx.getImageData(0, 0, lumaW, lumaH).data;
      const curLuma = new Uint8Array(lumaW * lumaH);
      let lumaSum = 0;
      for (let p = 0, q = 0; p < imgData.length; p += 4, q++) {
        const y = Math.round(0.299 * imgData[p] + 0.587 * imgData[p + 1] + 0.114 * imgData[p + 2]);
        curLuma[q] = y;
        lumaSum += y;
      }
      const brightnessMean = lumaSum / curLuma.length;
      const diffScore = prevLuma ? computeFrameDifferenceScore(prevLuma, curLuma) : 1;

      if (shouldKeepCandidateFrame(diffScore, brightnessMean, diffThreshold)) {
        captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
        const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.78);
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        frames.push({
          base64,
          mimeType: 'image/jpeg',
          timestampSec: Number(ts.toFixed(1)),
        });
        prevLuma = curLuma;
      }

      const pct = Math.min(100, Math.round(((i + 1) / timestamps.length) * 100));
      options?.onProgress?.(pct, frames.length);
    }

    // Free canvas backing buffers explicitly to keep mobile RAM minimal
    lumaCanvas.width = 0;
    lumaCanvas.height = 0;
    captureCanvas.width = 0;
    captureCanvas.height = 0;

    return frames;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}
