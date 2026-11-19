import type {
  AmbientSoundCategory,
  AmbientSoundPreset,
  CustomAmbientTrack,
} from '../types/book';

export const BUILTIN_AMBIENT_SOUNDS: AmbientSoundPreset[] = [
  // 1-10: Thiên nhiên & Thời tiết
  {
    id: 'rain_soft',
    name: 'Mưa rơi nhẹ',
    description: 'Tiếng mưa êm dịu rơi đều trên mái hiên',
    category: 'nature',
    emoji: '🌧️',
    defaultVolume: 0.45,
  },
  {
    id: 'rain_storm',
    name: 'Mưa rào & sấm xa',
    description: 'Mưa nặng hạt kèm tiếng sấm trầm ấm từ xa',
    category: 'nature',
    emoji: '⛈️',
    defaultVolume: 0.4,
  },
  {
    id: 'fireplace',
    name: 'Lửa trại tí tách',
    description: 'Ánh lửa củi cháy ấm áp, tiếng nổ lách tách',
    category: 'nature',
    emoji: '🔥',
    defaultVolume: 0.5,
  },
  {
    id: 'ocean_waves',
    name: 'Sóng biển rì rào',
    description: 'Nhịp sóng vỗ bờ biển đêm êm ả',
    category: 'nature',
    emoji: '🌊',
    defaultVolume: 0.42,
  },
  {
    id: 'forest_wind',
    name: 'Gió rừng thông',
    description: 'Tiếng gió vi vu thổi qua tán thông xanh',
    category: 'nature',
    emoji: '🌲',
    defaultVolume: 0.38,
  },
  {
    id: 'stream_water',
    name: 'Suối chảy róc rách',
    description: 'Dòng suối mát lành chảy qua khe đá',
    category: 'nature',
    emoji: '💧',
    defaultVolume: 0.42,
  },
  {
    id: 'waterfall',
    name: 'Thác nước sâu',
    description: 'Tiếng thác đổ đều giúp chặn tiếng ồn xung quanh',
    category: 'nature',
    emoji: '🏞️',
    defaultVolume: 0.32,
  },
  {
    id: 'night_crickets',
    name: 'Đêm quê & tiếng dế',
    description: 'Không gian đồng quê tĩnh mịch về đêm',
    category: 'nature',
    emoji: '🦗',
    defaultVolume: 0.35,
  },
  {
    id: 'morning_birds',
    name: 'Chim hót bình minh',
    description: 'Tiếng chim hót nhẹ nhàng buổi sớm mai',
    category: 'nature',
    emoji: '🐦',
    defaultVolume: 0.36,
  },
  {
    id: 'snow_wind',
    name: 'Gió tuyết mùa đông',
    description: 'Tiếng gió mùa đông trầm lắng đọc truyện kỳ ảo',
    category: 'nature',
    emoji: '❄️',
    defaultVolume: 0.34,
  },
  // 11-15: Không gian & Tập trung
  {
    id: 'cafe_lounge',
    name: 'Quán cà phê sách',
    description: 'Không khí ấm cúng của góc quán cà phê yên tĩnh',
    category: 'space',
    emoji: '☕',
    defaultVolume: 0.36,
  },
  {
    id: 'night_train',
    name: 'Tàu hỏa đêm',
    description: 'Nhịp bánh tàu lăn đều đặn đưa cảm xúc đi xa',
    category: 'space',
    emoji: '🚆',
    defaultVolume: 0.38,
  },
  {
    id: 'library_calm',
    name: 'Thư viện cổ tĩnh lặng',
    description: 'Không gian phòng đọc trầm ấm rất dễ tập trung',
    category: 'space',
    emoji: '📚',
    defaultVolume: 0.35,
  },
  {
    id: 'wind_chimes',
    name: 'Chuông gió hiên nhà',
    description: 'Tiếng chuông gió ngân khẽ trong làn gió nhẹ',
    category: 'space',
    emoji: '🎐',
    defaultVolume: 0.32,
  },
  {
    id: 'brown_noise',
    name: 'Tiếng ồn nâu tập trung',
    description: 'Âm trầm mượt giúp học tập và đọc nghiên cứu sâu',
    category: 'space',
    emoji: '🎧',
    defaultVolume: 0.3,
  },
  // 16-20: Nhạc Chill & Thiền
  {
    id: 'lofi_warm',
    name: 'Hợp âm Lo-fi chill',
    description: 'Đệm hợp âm Lo-fi ấm áp dễ chịu khi đọc sách',
    category: 'chill',
    emoji: '🎹',
    defaultVolume: 0.38,
  },
  {
    id: 'piano_night',
    name: 'Piano đêm tĩnh lặng',
    description: 'Nốt piano chậm rãi đầy cảm xúc cho tiểu thuyết',
    category: 'chill',
    emoji: '🎼',
    defaultVolume: 0.4,
  },
  {
    id: 'zen_alpha',
    name: 'Nhạc thiền thư giãn',
    description: 'Hòa âm êm dịu giúp tâm trí thư thái',
    category: 'chill',
    emoji: '🧘',
    defaultVolume: 0.35,
  },
  {
    id: 'guzheng_mist',
    name: 'Ngũ cung Á Đông',
    description: 'Âm hưởng cổ phong nhẹ hợp truyện kiếm hiệp, cổ trang',
    category: 'chill',
    emoji: '🪷',
    defaultVolume: 0.36,
  },
  {
    id: 'cosmic_drift',
    name: 'Đêm sao du dương',
    description: 'Ambient pad trôi nhẹ hợp tản văn và trước khi ngủ',
    category: 'chill',
    emoji: '🌌',
    defaultVolume: 0.34,
  },
];

export const AMBIENT_CATEGORY_LABELS: Record<'all' | AmbientSoundCategory | 'custom', string> = {
  all: 'Tất cả (20)',
  nature: 'Thiên nhiên',
  space: 'Không gian',
  chill: 'Nhạc Chill',
  custom: 'Nhạc đã Import',
};

export function clampAmbientVolume(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function mixEffectiveVolume(trackVolume: number, masterVolume: number): number {
  return Number((clampAmbientVolume(trackVolume) * clampAmbientVolume(masterVolume)).toFixed(4));
}

export function filterAmbientSounds(
  presets: AmbientSoundPreset[],
  category: 'all' | AmbientSoundCategory,
  searchQuery: string
): AmbientSoundPreset[] {
  const q = searchQuery.trim().toLowerCase();
  return presets.filter((item) => {
    const matchesCat = category === 'all' || item.category === category;
    if (!matchesCat) return false;
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q)
    );
  });
}

interface ActiveTrackHandle {
  volume: number;
  isCustom: boolean;
  setVolume: (effectiveVol: number) => void;
  stop: () => void;
}

export interface AmbientPlaybackSnapshot {
  masterVolume: number;
  activeVolumes: Record<string, number>;
}

class AmbientSoundManager {
  private ctx: AudioContext | null = null;
  private masterVolume = 0.65;
  private activeTracks = new Map<string, ActiveTrackHandle>();
  private listeners = new Set<(snap: AmbientPlaybackSnapshot) => void>();

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  subscribe(listener: (snap: AmbientPlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): AmbientPlaybackSnapshot {
    const activeVolumes: Record<string, number> = {};
    for (const [id, handle] of this.activeTracks.entries()) {
      activeVolumes[id] = handle.volume;
    }
    return {
      masterVolume: this.masterVolume,
      activeVolumes,
    };
  }

  private emit() {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  setMasterVolume(vol: number) {
    this.masterVolume = clampAmbientVolume(vol);
    for (const handle of this.activeTracks.values()) {
      handle.setVolume(mixEffectiveVolume(handle.volume, this.masterVolume));
    }
    this.emit();
  }

  setTrackVolume(trackId: string, vol: number) {
    const clean = clampAmbientVolume(vol);
    const handle = this.activeTracks.get(trackId);
    if (!handle) return;
    handle.volume = clean;
    handle.setVolume(mixEffectiveVolume(clean, this.masterVolume));
    this.emit();
  }

  isPlaying(trackId: string): boolean {
    return this.activeTracks.has(trackId);
  }

  toggleBuiltin(presetId: string) {
    if (this.activeTracks.has(presetId)) {
      this.stopTrack(presetId);
      return;
    }
    const preset = BUILTIN_AMBIENT_SOUNDS.find((s) => s.id === presetId);
    const vol = preset?.defaultVolume ?? 0.4;
    this.startBuiltin(presetId, vol);
  }

  toggleCustomTrack(track: CustomAmbientTrack) {
    if (this.activeTracks.has(track.id)) {
      this.stopTrack(track.id);
      return;
    }
    this.startCustomTrack(track, 0.55);
  }

  stopTrack(trackId: string) {
    const handle = this.activeTracks.get(trackId);
    if (!handle) return;
    handle.stop();
    this.activeTracks.delete(trackId);
    this.emit();
  }

  stopAll() {
    for (const handle of this.activeTracks.values()) {
      handle.stop();
    }
    this.activeTracks.clear();
    this.emit();
  }

  private startCustomTrack(track: CustomAmbientTrack, initialVolume: number) {
    if (typeof Audio === 'undefined') return;
    const audio = new Audio(track.dataUrl);
    audio.loop = true;
    audio.volume = mixEffectiveVolume(initialVolume, this.masterVolume);
    audio.play().catch(() => {});

    this.activeTracks.set(track.id, {
      volume: initialVolume,
      isCustom: true,
      setVolume: (eff) => {
        audio.volume = clampAmbientVolume(eff);
      },
      stop: () => {
        audio.pause();
        audio.src = '';
      },
    });
    this.emit();
  }

  private createNoiseBuffer(
    ctx: AudioContext,
    type: 'white' | 'pink' | 'brown',
    seconds = 4
  ): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    let lastOut = 0;

    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'white') {
        data[i] = white * 0.45;
      } else if (type === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.07;
        b6 = white * 0.115926;
      } else {
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 2.2;
      }
    }
    return buffer;
  }

  private startBuiltin(presetId: string, initialVolume: number) {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(
      mixEffectiveVolume(initialVolume, this.masterVolume),
      ctx.currentTime
    );
    trackGain.connect(ctx.destination);

    const stopCallbacks: Array<() => void> = [];
    const intervals: number[] = [];

    const addNoise = (
      type: 'white' | 'pink' | 'brown',
      filterType: BiquadFilterType,
      freq: number,
      q = 0.7,
      level = 0.7
    ) => {
      const src = ctx.createBufferSource();
      src.buffer = this.createNoiseBuffer(ctx, type, 4);
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = level;
      src.connect(filter);
      filter.connect(g);
      g.connect(trackGain);
      src.start();
      stopCallbacks.push(() => {
        try {
          src.stop();
          src.disconnect();
        } catch {
          // ignore
        }
      });
      return { filter, gain: g };
    };

    const addLfo = (
      targetParam: AudioParam,
      rateHz: number,
      depth: number
    ) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = rateHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth;
      osc.connect(lfoGain);
      lfoGain.connect(targetParam);
      osc.start();
      stopCallbacks.push(() => {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // ignore
        }
      });
    };

    const playTone = (
      freq: number,
      durationSec: number,
      gainVal: number,
      type: OscillatorType = 'sine',
      filterHz = 1800
    ) => {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterHz;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(gainVal, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
      osc.connect(filter);
      filter.connect(g);
      g.connect(trackGain);
      osc.start(now);
      osc.stop(now + durationSec + 0.05);
    };

    const addWarmPad = (freqs: number[], type: OscillatorType = 'triangle', level = 0.09) => {
      for (const f of freqs) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 680;
        const g = ctx.createGain();
        g.gain.value = level;
        osc.connect(filter);
        filter.connect(g);
        g.connect(trackGain);
        osc.start();
        addLfo(g.gain, 0.08 + Math.random() * 0.05, level * 0.35);
        stopCallbacks.push(() => {
          try {
            osc.stop();
            osc.disconnect();
          } catch {
            // ignore
          }
        });
      }
    };

    switch (presetId) {
      case 'rain_soft': {
        addNoise('pink', 'bandpass', 1100, 0.45, 0.65);
        addNoise('brown', 'lowpass', 420, 0.7, 0.35);
        break;
      }
      case 'rain_storm': {
        addNoise('pink', 'lowpass', 1400, 0.6, 0.72);
        const rumble = addNoise('brown', 'lowpass', 160, 0.8, 0.35);
        addLfo(rumble.gain.gain, 0.09, 0.2);
        break;
      }
      case 'fireplace': {
        addNoise('brown', 'lowpass', 320, 0.7, 0.55);
        const timer = window.setInterval(() => {
          if (Math.random() < 0.75) {
            playTone(1400 + Math.random() * 2600, 0.045, 0.07 + Math.random() * 0.08, 'triangle', 3200);
          }
        }, 160);
        intervals.push(timer);
        break;
      }
      case 'ocean_waves': {
        const wave = addNoise('pink', 'lowpass', 520, 0.6, 0.45);
        addLfo(wave.gain.gain, 0.12, 0.32);
        addLfo(wave.filter.frequency, 0.12, 260);
        break;
      }
      case 'forest_wind': {
        const wind = addNoise('pink', 'bandpass', 480, 1.3, 0.48);
        addLfo(wind.filter.frequency, 0.14, 210);
        addLfo(wind.gain.gain, 0.1, 0.18);
        break;
      }
      case 'stream_water': {
        addNoise('pink', 'bandpass', 950, 0.8, 0.45);
        const bubble = addNoise('white', 'bandpass', 2100, 2.2, 0.14);
        addLfo(bubble.filter.frequency, 0.35, 500);
        break;
      }
      case 'waterfall': {
        addNoise('pink', 'lowpass', 1350, 0.5, 0.6);
        addNoise('brown', 'lowpass', 380, 0.7, 0.5);
        break;
      }
      case 'night_crickets': {
        addNoise('brown', 'lowpass', 240, 0.7, 0.2);
        const timer = window.setInterval(() => {
          if (Math.random() < 0.6) {
            playTone(4150, 0.06, 0.04, 'sine', 5000);
            window.setTimeout(() => playTone(4220, 0.06, 0.035, 'sine', 5000), 85);
          }
        }, 1100);
        intervals.push(timer);
        break;
      }
      case 'morning_birds': {
        addNoise('pink', 'bandpass', 620, 0.8, 0.18);
        const notes = [1760, 2093, 2349, 2637, 2960];
        const timer = window.setInterval(() => {
          if (Math.random() < 0.7) {
            const n = notes[Math.floor(Math.random() * notes.length)];
            playTone(n, 0.18, 0.05, 'sine', 4200);
            if (Math.random() < 0.5) {
              window.setTimeout(() => playTone(n * 1.12, 0.14, 0.04, 'sine', 4200), 140);
            }
          }
        }, 1400);
        intervals.push(timer);
        break;
      }
      case 'snow_wind': {
        const howl = addNoise('pink', 'bandpass', 340, 2.4, 0.42);
        addLfo(howl.filter.frequency, 0.08, 160);
        break;
      }
      case 'cafe_lounge': {
        addNoise('brown', 'lowpass', 480, 0.6, 0.4);
        addNoise('pink', 'bandpass', 880, 0.9, 0.25);
        const timer = window.setInterval(() => {
          if (Math.random() < 0.3) {
            playTone(1320 + Math.random() * 600, 0.12, 0.025, 'sine', 2400);
          }
        }, 1800);
        intervals.push(timer);
        break;
      }
      case 'night_train': {
        const base = addNoise('brown', 'lowpass', 260, 0.7, 0.5);
        addLfo(base.gain.gain, 0.4, 0.12);
        const timer = window.setInterval(() => {
          playTone(110, 0.09, 0.12, 'triangle', 320);
          window.setTimeout(() => playTone(98, 0.09, 0.1, 'triangle', 320), 180);
        }, 900);
        intervals.push(timer);
        break;
      }
      case 'library_calm': {
        addNoise('brown', 'lowpass', 210, 0.7, 0.28);
        const timer = window.setInterval(() => {
          if (Math.random() < 0.25) {
            playTone(1600, 0.08, 0.015, 'triangle', 2200);
          }
        }, 2800);
        intervals.push(timer);
        break;
      }
      case 'wind_chimes': {
        const breeze = addNoise('pink', 'bandpass', 520, 1.1, 0.2);
        addLfo(breeze.gain.gain, 0.11, 0.1);
        const chimeNotes = [523.25, 659.25, 783.99, 987.77, 1046.5];
        const timer = window.setInterval(() => {
          const n = chimeNotes[Math.floor(Math.random() * chimeNotes.length)];
          playTone(n, 2.2, 0.055, 'sine', 3000);
        }, 1700);
        intervals.push(timer);
        break;
      }
      case 'brown_noise': {
        addNoise('brown', 'lowpass', 360, 0.65, 0.65);
        break;
      }
      case 'lofi_warm': {
        addWarmPad([174.61, 220, 261.63, 329.63], 'triangle', 0.08); // Fmaj7
        const lofiNotes = [349.23, 392.0, 440.0, 523.25];
        const timer = window.setInterval(() => {
          const n = lofiNotes[Math.floor(Math.random() * lofiNotes.length)];
          playTone(n, 1.6, 0.06, 'sine', 1200);
        }, 1900);
        intervals.push(timer);
        break;
      }
      case 'piano_night': {
        const pianoScale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25];
        let step = 0;
        const timer = window.setInterval(() => {
          const n = pianoScale[step % pianoScale.length];
          step += Math.random() > 0.4 ? 1 : 2;
          playTone(n, 2.4, 0.09, 'triangle', 1450);
        }, 1350);
        intervals.push(timer);
        break;
      }
      case 'zen_alpha': {
        addWarmPad([136.1, 204.15, 272.2], 'sine', 0.1);
        break;
      }
      case 'guzheng_mist': {
        const pentatonic = [293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
        const timer = window.setInterval(() => {
          const n = pentatonic[Math.floor(Math.random() * pentatonic.length)];
          playTone(n, 1.9, 0.075, 'triangle', 2200);
        }, 1150);
        intervals.push(timer);
        break;
      }
      case 'cosmic_drift':
      default: {
        addWarmPad([130.81, 196.0, 246.94, 293.66], 'sine', 0.085);
        break;
      }
    }

    this.activeTracks.set(presetId, {
      volume: initialVolume,
      isCustom: false,
      setVolume: (eff) => {
        trackGain.gain.setTargetAtTime(clampAmbientVolume(eff), ctx.currentTime, 0.06);
      },
      stop: () => {
        for (const id of intervals) window.clearInterval(id);
        for (const fn of stopCallbacks) fn();
        try {
          trackGain.disconnect();
        } catch {
          // ignore
        }
      },
    });
    this.emit();
  }
}

export const ambientSoundManager = new AmbientSoundManager();
