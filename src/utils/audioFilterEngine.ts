import type { VoiceToneSettings } from '../types/book';

export const MIN_READING_SPEED = 0.5;
export const MAX_READING_SPEED = 3.0;
export const READING_SPEED_STEP = 0.1;
export const READING_SPEED_PRESETS = [0.8, 1.0, 1.2, 1.5, 2.0, 2.5];

export function normalizeReadingSpeed(raw: number | string, fallback = 1.0): number {
  const parsed =
    typeof raw === 'number'
      ? raw
      : Number(String(raw).trim().replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const clamped = Math.min(MAX_READING_SPEED, Math.max(MIN_READING_SPEED, parsed));
  return Math.round(clamped * 10) / 10;
}

export function stepReadingSpeed(current: number, deltaSteps: number): number {
  const base = normalizeReadingSpeed(current, 1.0);
  const next = Math.round((base + deltaSteps * READING_SPEED_STEP) * 10) / 10;
  return Math.min(MAX_READING_SPEED, Math.max(MIN_READING_SPEED, next));
}

export function formatReadingSpeed(speed: number): string {
  return normalizeReadingSpeed(speed, 1.0).toFixed(1);
}

export const DEFAULT_VOICE_TONE: VoiceToneSettings = {
  warmthDb: 0,
  clarityDb: 0,
  pitch: 1.0,
  rate: 1.0,
  styleDirection: 'Truyền cảm, rõ ràng, tự nhiên',
};

export interface TonePreset {
  id: string;
  label: string;
  description: string;
  tone: VoiceToneSettings;
}

export const VOICE_TONE_PRESETS: TonePreset[] = [
  {
    id: 'warm-deep',
    label: 'Ấm trầm kể chuyện đêm',
    description: 'Tăng âm trầm 240Hz giúp giọng dày, ấm áp, dễ chịu khi nghe lâu',
    tone: {
      warmthDb: 7,
      clarityDb: -1,
      pitch: 0.9,
      rate: 0.95,
      styleDirection: 'Giọng trầm ấm, sâu lắng, nhịp chậm rãi như kể chuyện đêm khuya',
    },
  },
  {
    id: 'bright-confident',
    label: 'Mạnh mẽ & Tự tin (Văn phong học tập)',
    description: 'Tăng độ sáng rõ, nhấn mạnh dứt khoát các luận điểm quan trọng',
    tone: {
      warmthDb: 2,
      clarityDb: 5,
      pitch: 1.05,
      rate: 1.05,
      styleDirection: 'Giọng tự tin, hùng hồn, nhấn nhá rõ ràng vào từ khóa và bài học cốt lõi',
    },
  },
  {
    id: 'gentle-inspiring',
    label: 'Nhẹ nhàng truyền cảm (Tản văn)',
    description: 'Cân bằng dịu êm, giàu chất thơ và khoảng lặng tinh tế',
    tone: {
      warmthDb: 4,
      clarityDb: 2,
      pitch: 1.02,
      rate: 0.92,
      styleDirection: 'Giọng nhẹ nhàng, dịu dàng, truyền cảm hứng và giàu cảm xúc',
    },
  },
  {
    id: 'dramatic-novel',
    label: 'Kịch tính điện ảnh (Tiểu thuyết)',
    description: 'Biên độ sắc nét cho hội thoại hồi hộp, hoảng hốt hoặc hào hùng',
    tone: {
      warmthDb: 3,
      clarityDb: 4,
      pitch: 1.0,
      rate: 1.0,
      styleDirection: 'Diễn xuất giàu kịch tính, thay đổi sắc thái linh hoạt theo tâm lý nhân vật',
    },
  },
];

export interface MediaSessionMeta {
  title: string;
  artist: string;
  album?: string;
}

export interface MediaSessionHandlers {
  onPlay?: () => void;
  onPause?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onStop?: () => void;
}

/**
 * Registers lock-screen / notification-bar playback controls via Media Session API
 * so audio keeps playing cleanly in background on Android, iOS, and desktop browsers.
 */
export function updateMediaSession(
  meta: MediaSessionMeta,
  playbackState: 'playing' | 'paused' | 'none',
  handlers?: MediaSessionHandlers
): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    const ms = navigator.mediaSession;
    if (typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({
        title: meta.title,
        artist: meta.artist,
        album: meta.album || 'LaziRead Sách Nói AI',
      });
    }
    ms.playbackState = playbackState;

    if (handlers) {
      const safeSet = (action: MediaSessionAction, fn?: () => void) => {
        try {
          ms.setActionHandler(action, fn ? () => fn() : null);
        } catch {
          // Action not supported on this browser
        }
      };
      safeSet('play', handlers.onPlay);
      safeSet('pause', handlers.onPause);
      safeSet('previoustrack', handlers.onPrev);
      safeSet('nexttrack', handlers.onNext);
      safeSet('stop', handlers.onStop);
    }
  } catch {
    // Ignore Media Session errors on unsupported environments
  }
}

export function clearMediaSession(): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.playbackState = 'none';
  } catch {
    // Ignore
  }
}

/**
 * Plays audio segments through ONE single persistent HTMLAudioElement so mobile browsers
 * allow continuous background playback across paragraphs/chapters when the screen locks
 * or user switches apps. Also drives progress via both `timeupdate` (background-safe)
 * and `requestAnimationFrame` (60fps foreground word-by-word illumination).
 */
export class FilteredAudioPlayer {
  private ctx: AudioContext | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private mediaSourceConnected = false;
  private lowShelf: BiquadFilterNode | null = null;
  private highShelf: BiquadFilterNode | null = null;
  private rafId: number | null = null;
  private objectUrl: string | null = null;
  private activeResolve: (() => void) | null = null;

  private ensureAudioElement(): HTMLAudioElement {
    if (!this.audioEl) {
      const el = new Audio();
      el.preload = 'auto';
      el.setAttribute('playsinline', 'true');
      this.audioEl = el;
    }
    return this.audioEl;
  }

  private clearActiveListeners() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioEl) {
      this.audioEl.onplay = null;
      this.audioEl.ontimeupdate = null;
      this.audioEl.onended = null;
      this.audioEl.onerror = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  stop() {
    this.clearActiveListeners();
    if (this.audioEl) {
      this.audioEl.pause();
      try {
        this.audioEl.currentTime = 0;
      } catch {
        // Ignore if not seekable
      }
    }
    if (this.activeResolve) {
      const resolve = this.activeResolve;
      this.activeResolve = null;
      resolve();
    }
  }

  dispose() {
    this.stop();
    if (this.audioEl) {
      this.audioEl.src = '';
      this.audioEl = null;
      this.mediaSourceConnected = false;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.lowShelf = null;
    this.highShelf = null;
  }

  updateTone(tone?: VoiceToneSettings, speedMultiplier = 1.0) {
    if (!tone) return;
    if (this.lowShelf) this.lowShelf.gain.value = tone.warmthDb;
    if (this.highShelf) this.highShelf.gain.value = tone.clarityDb;
    if (this.audioEl) {
      this.audioEl.playbackRate = Math.min(
        MAX_READING_SPEED,
        Math.max(MIN_READING_SPEED, tone.rate * speedMultiplier)
      );
    }
  }

  setSpeed(speed: number) {
    if (this.audioEl) {
      this.audioEl.playbackRate = Math.min(
        MAX_READING_SPEED,
        Math.max(MIN_READING_SPEED, speed)
      );
    }
  }

  private toPlayableUrl(src: string): string {
    if (!src.startsWith('data:')) return src;
    try {
      const [header, b64] = src.split(',');
      const mimeMatch = header.match(/data:([^;]+);base64/i);
      const mime = mimeMatch ? mimeMatch[1] : 'audio/wav';
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mime });
      this.objectUrl = URL.createObjectURL(blob);
      return this.objectUrl;
    } catch {
      return src;
    }
  }

  private ensureEqGraph(audio: HTMLAudioElement, tone: VoiceToneSettings) {
    const needsEq = Math.abs(tone.warmthDb) > 0.1 || Math.abs(tone.clarityDb) > 0.1;

    if (this.mediaSourceConnected && this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      if (this.lowShelf) this.lowShelf.gain.value = tone.warmthDb;
      if (this.highShelf) this.highShelf.gain.value = tone.clarityDb;
      return;
    }

    if (!needsEq || typeof AudioContext === 'undefined') return;

    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const source = ctx.createMediaElementSource(audio);

      const lowShelf = ctx.createBiquadFilter();
      lowShelf.type = 'lowshelf';
      lowShelf.frequency.value = 240;
      lowShelf.gain.value = tone.warmthDb;

      const highShelf = ctx.createBiquadFilter();
      highShelf.type = 'highshelf';
      highShelf.frequency.value = 3200;
      highShelf.gain.value = tone.clarityDb;

      source.connect(lowShelf);
      lowShelf.connect(highShelf);
      highShelf.connect(ctx.destination);

      this.ctx = ctx;
      this.lowShelf = lowShelf;
      this.highShelf = highShelf;
      this.mediaSourceConnected = true;
    } catch {
      // Fallback cleanly to native <audio> playback without EQ
    }
  }

  async play(
    src: string,
    tone: VoiceToneSettings = DEFAULT_VOICE_TONE,
    speedMultiplier = 1.0,
    onProgress?: (ratio: number) => void
  ): Promise<void> {
    this.clearActiveListeners();
    const audio = this.ensureAudioElement();
    audio.pause();

    const playableUrl = this.toPlayableUrl(src);
    audio.src = playableUrl;
    audio.playbackRate = Math.min(
      MAX_READING_SPEED,
      Math.max(MIN_READING_SPEED, tone.rate * speedMultiplier)
    );
    this.ensureEqGraph(audio, tone);

    return new Promise((resolve, reject) => {
      this.activeResolve = resolve;

      const emitRatio = () => {
        if (audio.duration > 0 && Number.isFinite(audio.duration)) {
          onProgress?.(Math.min(1, audio.currentTime / audio.duration));
        }
      };

      const tick = () => {
        if (this.audioEl === audio && !audio.paused && !audio.ended) {
          emitRatio();
          this.rafId = requestAnimationFrame(tick);
        }
      };

      audio.onplay = () => {
        if (onProgress && typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.rafId = requestAnimationFrame(tick);
        }
      };

      // Fires reliably even when the screen is off or browser tab is in background
      audio.ontimeupdate = () => {
        emitRatio();
      };

      audio.onended = () => {
        onProgress?.(1);
        this.clearActiveListeners();
        this.activeResolve = null;
        resolve();
      };

      audio.onerror = () => {
        this.clearActiveListeners();
        this.activeResolve = null;
        reject(new Error('Không thể giải mã hoặc phát luồng âm thanh trên trình duyệt.'));
      };

      audio.play().catch((err) => {
        this.clearActiveListeners();
        this.activeResolve = null;
        reject(
          err instanceof Error
            ? err
            : new Error('Trình duyệt chặn tự phát âm thanh. Hãy bấm Phát lại.')
        );
      });
    });
  }
}
