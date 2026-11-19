import type { VoiceToneSettings } from '../types/book';

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

/**
 * Plays an audio data URL through a live Web Audio API EQ chain
 * (LowShelf for Warmth/Bass + HighShelf for Clarity) + playbackRate.
 */
export class FilteredAudioPlayer {
  private ctx: AudioContext | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private lowShelf: BiquadFilterNode | null = null;
  private highShelf: BiquadFilterNode | null = null;
  private rafId: number | null = null;

  stop() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
      this.audioEl.src = '';
      this.audioEl = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  updateTone(tone?: VoiceToneSettings) {
    if (!tone) return;
    if (this.lowShelf) this.lowShelf.gain.value = tone.warmthDb;
    if (this.highShelf) this.highShelf.gain.value = tone.clarityDb;
    if (this.audioEl) this.audioEl.playbackRate = Math.min(2, Math.max(0.5, tone.rate));
  }

  async play(
    src: string,
    tone: VoiceToneSettings = DEFAULT_VOICE_TONE,
    speedMultiplier = 1.0,
    onProgress?: (ratio: number) => void
  ): Promise<void> {
    this.stop();
    const audio = new Audio(src);
    audio.crossOrigin = 'anonymous';
    audio.playbackRate = Math.min(2.0, Math.max(0.5, tone.rate * speedMultiplier));
    this.audioEl = audio;

    // Attach Web Audio API EQ if supported
    if (typeof AudioContext !== 'undefined') {
      try {
        const ctx = new AudioContext();
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
      } catch {
        // Fallback to direct <audio> playback if MediaElementSource fails
      }
    }

    return new Promise((resolve) => {
      const tick = () => {
        if (this.audioEl && this.audioEl.duration > 0 && !this.audioEl.paused) {
          onProgress?.(this.audioEl.currentTime / this.audioEl.duration);
          this.rafId = requestAnimationFrame(tick);
        }
      };

      audio.onplay = () => {
        if (onProgress) this.rafId = requestAnimationFrame(tick);
      };
      audio.onended = () => {
        onProgress?.(1);
        this.stop();
        resolve();
      };
      audio.onerror = () => {
        this.stop();
        resolve();
      };
      audio.play().catch(() => {
        this.stop();
        resolve();
      });
    });
  }
}
