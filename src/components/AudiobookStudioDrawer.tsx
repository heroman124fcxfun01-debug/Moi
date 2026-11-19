import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
  Loader2,
  Users,
  Square,
} from 'lucide-react';
import type {
  Book,
  BookReadingStyle,
  Chapter,
  ChapterAnalysis,
  CharacterVoiceAssignment,
  CharacterVoiceSource,
  CustomAmbientTrack,
  ExternalVoiceAsset,
  GeminiVoiceName,
  VoiceToneSettings,
} from '../types/book';
import { GEMINI_VOICES, createExternalVoiceFromFile } from '../utils/fileHelpers';
import { DEFAULT_VOICE_TONE, FilteredAudioPlayer } from '../utils/audioFilterEngine';
import { ambientSoundManager } from '../utils/ambientSoundEngine';
import { resolveApiUrl } from '../utils/apiClient';
import { AmbientSoundPanel } from './AmbientSoundPanel';

interface AudiobookStudioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  book: Book;
  chapter: Chapter;
  autoPlaySignal?: number;
  onSaveChapterAnalysis: (chapterId: string, analysis: ChapterAnalysis) => void;
  onUpdateVoiceAssignment: (
    characterId: string,
    assignment: CharacterVoiceAssignment
  ) => void;
  externalVoices: ExternalVoiceAsset[];
  onAddExternalVoice: (voice: ExternalVoiceAsset) => Promise<void>;
  customAmbientTracks?: CustomAmbientTrack[];
  onAddCustomAmbientTrack?: (track: CustomAmbientTrack) => Promise<void>;
  onDeleteCustomAmbientTrack?: (trackId: string) => Promise<void>;
  onHighlightParagraph: (paragraphIndex: number | null, progressRatio?: number) => void;
  onSyncReadingParagraph?: (paragraphIndex: number) => void;
  onPlaybackStateChange?: (isPlaying: boolean) => void;
  onNextChapter: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  narrator: 'Người dẫn / Diễn giả',
  protagonist: 'Nhân vật chính',
  supporting: 'Nhân vật phụ',
  antagonist: 'Phản diện',
};

const STYLE_LABELS: Record<BookReadingStyle, string> = {
  novel: 'Tiểu thuyết (Diễn cảm nhiều nhân vật)',
  selfhelp: 'Văn phong học tập (Nhấn điểm quan trọng)',
  essay: 'Tản văn (Nhẹ nhàng, truyền cảm hứng)',
  research: 'Nghiên cứu (Mạch lạc, chuẩn xác)',
};

const QUICK_EMOTION_PROMPTS = [
  'Hoảng hốt, sợ hãi, thở gấp',
  'Mạnh mẽ, hùng hồn, tự tin',
  'Nhẹ nhàng, tình yêu ấm áp',
  'Nhấn mạnh điểm quan trọng, dứt khoát',
  'Ấm trầm, sâu lắng, truyền cảm',
];

export const AudiobookStudioDrawer: React.FC<AudiobookStudioDrawerProps> = ({
  isOpen,
  onClose,
  book,
  chapter,
  autoPlaySignal = 0,
  onSaveChapterAnalysis,
  onUpdateVoiceAssignment,
  externalVoices,
  onAddExternalVoice,
  customAmbientTracks = [],
  onAddCustomAmbientTrack = async () => {},
  onDeleteCustomAmbientTrack = async () => {},
  onHighlightParagraph,
  onSyncReadingParagraph,
  onPlaybackStateChange,
  onNextChapter,
}) => {
  const [activeTab, setActiveTab] = useState<'player' | 'characters' | 'ambient'>('player');
  const [ambientActiveCount, setAmbientActiveCount] = useState(
    () => Object.keys(ambientSoundManager.getSnapshot().activeVolumes).length
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingVoice, setIsAnalyzingVoice] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    return ambientSoundManager.subscribe((snap) => {
      setAmbientActiveCount(Object.keys(snap.activeVolumes).length);
    });
  }, []);

  // Playback state
  const [engineMode, setEngineMode] = useState<'gemini' | 'browser'>('gemini');
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  const [currentSegIndex, setCurrentSegIndex] = useState(0);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);

  const voiceFileRef = useRef<HTMLInputElement>(null);
  const filteredPlayerRef = useRef<FilteredAudioPlayer | null>(null);
  const isPlayingRef = useRef(false);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const handledSignalRef = useRef(0);

  const analysis = chapter.analysis;
  const readingStyle: BookReadingStyle = book.readingStyle || 'novel';

  const getPlayer = () => {
    if (!filteredPlayerRef.current) {
      filteredPlayerRef.current = new FilteredAudioPlayer();
    }
    return filteredPlayerRef.current;
  };

  // Fallback script if chapter hasn't been analyzed yet (treats every paragraph as Narrator)
  const effectiveScript =
    analysis?.script && analysis.script.length > 0
      ? analysis.script
      : chapter.paragraphs.map((p, idx) => ({
          id: `fallback-${idx}`,
          paragraphIndex: idx,
          speakerId: 'narrator',
          speakerName: readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
          emotionStyle:
            readingStyle === 'selfhelp'
              ? 'Tự tin, nhấn mạnh ý trọng tâm'
              : readingStyle === 'essay'
              ? 'Nhẹ nhàng, truyền cảm hứng'
              : readingStyle === 'research'
              ? 'Rõ ràng, mạch lạc'
              : 'Truyền cảm, tự nhiên',
          text: p,
        }));

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const list = window.speechSynthesis.getVoices();
      setBrowserVoices(list);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, []);

  useEffect(() => {
    return () => {
      stopAllAudio();
    };
  }, [chapter.id]);

  // Sync start position to currentParagraphIndex when user clicks "Nghe tiếp từ đây"
  useEffect(() => {
    if (!isOpen || autoPlaySignal === 0 || autoPlaySignal === handledSignalRef.current) return;
    handledSignalRef.current = autoPlaySignal;

    const targetIdx = effectiveScript.findIndex(
      (s) => s.paragraphIndex >= (book.currentParagraphIndex || 0)
    );
    const startIdx = targetIdx >= 0 ? targetIdx : 0;
    setActiveTab('player');
    setCurrentSegIndex(startIdx);
    stopAllAudio();
    isPlayingRef.current = true;
    setIsPlaying(true);
    playSegmentAt(startIdx);
  }, [autoPlaySignal, isOpen]);

  useEffect(() => {
    onPlaybackStateChange?.(isPlaying);
  }, [isPlaying, onPlaybackStateChange]);

  const stopAllAudio = () => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    setIsLoadingAudio(false);
    setPreviewingId(null);
    filteredPlayerRef.current?.stop();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    onHighlightParagraph(null, 0);
  };

  const getAssignment = (charId: string, suggested?: GeminiVoiceName): CharacterVoiceAssignment => {
    const existing = book.voiceAssignments?.[charId];
    if (existing) return existing;
    return {
      characterId: charId,
      source: 'gemini',
      geminiVoice: suggested || (charId === 'narrator' ? 'Kore' : 'Puck'),
      stylePrompt:
        charId === 'narrator'
          ? 'Giọng kể chuyện truyền cảm, ấm áp'
          : 'Tự nhiên theo ngữ cảnh nhân vật',
      browserPitch: 1.0,
      browserRate: 1.0,
      toneSettings: { ...DEFAULT_VOICE_TONE },
    };
  };

  const handleAnalyzeStory = async () => {
    setErrorMsg('');
    setIsAnalyzing(true);
    try {
      const resp = await fetch(resolveApiUrl('/api/ai/analyze-characters'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: chapter.title,
          paragraphs: chapter.paragraphs,
          readingStyle,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Không thể phân tích nhân vật.');
      }

      const normalized: ChapterAnalysis = {
        estimatedTotalCharacters: data.estimatedTotalCharacters ?? (data.characters?.length || 1),
        readingStyle,
        summary: data.summary || '',
        characters: Array.isArray(data.characters) ? data.characters : [],
        script: Array.isArray(data.script)
          ? data.script.map((s: Record<string, unknown>, idx: number) => ({
              id: `seg-${idx}`,
              paragraphIndex: Number(s.paragraphIndex ?? 0),
              speakerId: String(s.speakerId || 'narrator'),
              speakerName: String(s.speakerName || 'Người dẫn chuyện'),
              emotionStyle: String(s.emotionStyle || 'Tự nhiên'),
              text: String(s.text || ''),
            }))
          : [],
        analyzedAt: Date.now(),
      };

      onSaveChapterAnalysis(chapter.id, normalized);

      for (const ch of normalized.characters) {
        if (!book.voiceAssignments?.[ch.id]) {
          onUpdateVoiceAssignment(ch.id, {
            characterId: ch.id,
            source: 'gemini',
            geminiVoice: (['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'].includes(
              ch.suggestedVoiceName
            )
              ? ch.suggestedVoiceName
              : ch.gender === 'female'
              ? 'Kore'
              : 'Charon') as GeminiVoiceName,
            stylePrompt: ch.voiceDescription || 'Truyền cảm theo tính cách nhân vật',
            browserPitch: ch.gender === 'female' ? 1.15 : 0.9,
            browserRate: 1.0,
            toneSettings: { ...DEFAULT_VOICE_TONE },
          });
        }
      }
      setActiveTab('characters');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi phân tích truyện.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleImportVoiceFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg('');
    setIsAnalyzingVoice(true);
    try {
      const file = files[0];
      const asset = await createExternalVoiceFromFile(file);
      asset.toneSettings = { ...DEFAULT_VOICE_TONE };
      const [, b64] = asset.dataUrl.split(',');

      try {
        const resp = await fetch(resolveApiUrl('/api/ai/analyze-voice-sample'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            audioBase64: b64,
            mimeType: asset.mimeType,
            fileName: asset.fileName,
          }),
        });
        if (resp.ok) {
          asset.analyzedProfile = await resp.json();
        }
      } catch {
        // Keep asset even if AI audio profiling fails
      }

      await onAddExternalVoice(asset);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Không thể nhập tệp giọng nói.');
    } finally {
      setIsAnalyzingVoice(false);
    }
  };

  const resolveTtsParamsForSpeaker = (speakerId: string, emotionStyle: string) => {
    const assign = getAssignment(speakerId);
    const assignTone: VoiceToneSettings = assign.toneSettings || {
      ...DEFAULT_VOICE_TONE,
      pitch: assign.browserPitch,
      rate: assign.browserRate,
    };

    if (assign.source === 'external' && assign.externalVoiceId) {
      const ext = externalVoices.find((v) => v.id === assign.externalVoiceId);
      const extTone = ext?.toneSettings || assignTone;
      if (ext?.analyzedProfile) {
        return {
          voiceName: ext.analyzedProfile.recommendedBaseVoice || assign.geminiVoice,
          stylePrompt: `${ext.analyzedProfile.stylePrompt}. Cảm xúc đoạn này: ${emotionStyle}`,
          pitch: ext.analyzedProfile.pitchHint || extTone.pitch,
          rate: ext.analyzedProfile.rateHint || extTone.rate,
          tone: extTone,
          externalAsset: ext,
        };
      }
      return {
        voiceName: assign.geminiVoice,
        stylePrompt: `${assign.stylePrompt}. Cảm xúc: ${emotionStyle}`,
        pitch: extTone.pitch,
        rate: extTone.rate,
        tone: extTone,
        externalAsset: ext,
      };
    }

    return {
      voiceName: assign.geminiVoice,
      stylePrompt: `${assign.stylePrompt}. Cảm xúc đoạn này: ${emotionStyle}`,
      pitch: assignTone.pitch || assign.browserPitch,
      rate: assignTone.rate || assign.browserRate,
      tone: assignTone,
      externalAsset: undefined,
    };
  };

  const fetchGeminiTtsUrl = async (
    text: string,
    voiceName: GeminiVoiceName,
    stylePrompt: string
  ): Promise<string> => {
    const cacheKey = `${readingStyle}|${voiceName}|${stylePrompt}|${text}`;
    const cached = audioCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const resp = await fetch(resolveApiUrl('/api/ai/tts'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceName,
        stylePrompt,
        readingStyle,
        expressive: true,
      }),
    });
    const data = await resp.json();
    if (!resp.ok || !data.audioBase64) {
      throw new Error(data.error || 'Không tạo được âm thanh AI.');
    }
    const dataUrl = `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
    audioCacheRef.current.set(cacheKey, dataUrl);
    return dataUrl;
  };

  const playBrowserSpeech = (
    text: string,
    pitch: number,
    rate: number,
    voiceURI?: string,
    paragraphIdx?: number
  ): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      const viVoice =
        browserVoices.find((v) => v.voiceURI === voiceURI) ||
        browserVoices.find((v) => v.lang.toLowerCase().startsWith('vi'));
      if (viVoice) utter.voice = viVoice;
      utter.lang = viVoice?.lang || (book.language === 'en' ? 'en-US' : 'vi-VN');
      utter.pitch = pitch;
      utter.rate = Math.min(2, Math.max(0.5, rate * playbackSpeed));
      utter.onboundary = (ev) => {
        if (paragraphIdx !== undefined && text.length > 0) {
          onHighlightParagraph(paragraphIdx, Math.min(1, (ev.charIndex + 12) / text.length));
        }
      };
      utter.onend = () => {
        if (paragraphIdx !== undefined) onHighlightParagraph(paragraphIdx, 1);
        resolve();
      };
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  };

  const playSegmentAt = async (index: number) => {
    if (index >= effectiveScript.length) {
      stopAllAudio();
      return;
    }
    const seg = effectiveScript[index];
    setCurrentSegIndex(index);
    onHighlightParagraph(seg.paragraphIndex, 0.05);
    onSyncReadingParagraph?.(seg.paragraphIndex);

    const assign = getAssignment(seg.speakerId);
    const params = resolveTtsParamsForSpeaker(seg.speakerId, seg.emotionStyle);
    const useBrowser = engineMode === 'browser' || assign.source === 'browser';

    if (useBrowser) {
      await playBrowserSpeech(
        seg.text,
        params.pitch,
        params.rate,
        assign.browserVoiceURI,
        seg.paragraphIndex
      );
      if (isPlayingRef.current) {
        await playSegmentAt(index + 1);
      }
      return;
    }

    setIsLoadingAudio(true);
    try {
      const audioSrc = await fetchGeminiTtsUrl(
        seg.text,
        params.voiceName as GeminiVoiceName,
        params.stylePrompt
      );
      if (!isPlayingRef.current) return;

      // Prefetch next segment quietly
      if (index + 1 < effectiveScript.length) {
        const nextSeg = effectiveScript[index + 1];
        const nextParams = resolveTtsParamsForSpeaker(nextSeg.speakerId, nextSeg.emotionStyle);
        fetchGeminiTtsUrl(
          nextSeg.text,
          nextParams.voiceName as GeminiVoiceName,
          nextParams.stylePrompt
        ).catch(() => {});
      }

      setIsLoadingAudio(false);
      await getPlayer().play(audioSrc, params.tone, playbackSpeed, (ratio) => {
        if (isPlayingRef.current) {
          onHighlightParagraph(seg.paragraphIndex, ratio);
        }
      });

      if (isPlayingRef.current) {
        await playSegmentAt(index + 1);
      }
    } catch (err) {
      setIsLoadingAudio(false);
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi phát giọng AI.');
      stopAllAudio();
    }
  };

  const handleTogglePlay = async () => {
    if (isPlaying) {
      stopAllAudio();
      return;
    }
    setErrorMsg('');
    setActiveTab('player');
    isPlayingRef.current = true;
    setIsPlaying(true);
    await playSegmentAt(currentSegIndex);
  };

  const handlePreviewCharacter = async (charId: string, sampleText: string) => {
    stopAllAudio();
    setErrorMsg('');
    setPreviewingId(charId);
    const assign = getAssignment(charId);
    const params = resolveTtsParamsForSpeaker(charId, 'Tự nhiên');

    try {
      if (assign.source === 'external' && params.externalAsset?.dataUrl) {
        await getPlayer().play(params.externalAsset.dataUrl, params.tone, 1.0);
        setPreviewingId(null);
        return;
      }

      if (engineMode === 'browser' || assign.source === 'browser') {
        await playBrowserSpeech(
          sampleText || 'Xin chào, đây là giọng đọc thử của nhân vật.',
          params.pitch,
          params.rate,
          assign.browserVoiceURI
        );
        setPreviewingId(null);
        return;
      }

      const audioSrc = await fetchGeminiTtsUrl(
        sampleText || 'Xin chào, đây là giọng đọc AI lồng tiếng cho nhân vật.',
        params.voiceName as GeminiVoiceName,
        params.stylePrompt
      );
      await getPlayer().play(audioSrc, params.tone, playbackSpeed);
      setPreviewingId(null);
    } catch (err) {
      setPreviewingId(null);
      setErrorMsg(err instanceof Error ? err.message : 'Không phát thử được giọng.');
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      aria-label="Phòng thu sách nói AI và phân vai nhân vật"
      className="ios-drawer-right fixed inset-y-0 right-0 z-40 w-full max-w-md lg:static lg:z-20 lg:w-[420px] lg:shrink-0 lg:sticky lg:top-[105px] lg:h-[calc(100vh-105px)] bg-[#FBF9F5]/95 dark:bg-[#16181C]/95 backdrop-blur-xl text-stone-900 dark:text-stone-100 border-l border-stone-200/80 dark:border-stone-800 rounded-l-3xl lg:rounded-none shadow-2xl lg:shadow-none flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 dark:border-stone-800">
        <div className="min-w-0">
          <h2 className="text-base font-display font-semibold truncate">
            Nghe AI & Lồng Tiếng Nhân Vật
          </h2>
          <p className="text-[11px] text-amber-800 dark:text-amber-400 truncate">
            {STYLE_LABELS[readingStyle]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            stopAllAudio();
            onClose();
          }}
          aria-label="Đóng phòng thu sách nói"
          className="p-2 rounded-md text-stone-500 hover:text-stone-900 dark:hover:text-stone-100 hover:bg-stone-200/60 dark:hover:bg-stone-800 shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Liquid-Glass Sub-navigation Tabs */}
      <div className="px-5 pt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex p-1 ios-liquid-bar border border-white/75 dark:border-zinc-700/60 rounded-full gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('player')}
            className={`ios-liquid-pill px-2.5 py-1.5 text-[11px] font-medium rounded-full whitespace-nowrap ${
              activeTab === 'player'
                ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            Phát & Sáng chữ
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('characters')}
            className={`ios-liquid-pill px-2.5 py-1.5 text-[11px] font-medium rounded-full whitespace-nowrap ${
              activeTab === 'characters'
                ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            Nhân vật
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ambient')}
            className={`ios-liquid-pill px-2.5 py-1.5 text-[11px] font-medium rounded-full whitespace-nowrap ${
              activeTab === 'ambient'
                ? 'ios-liquid-pill-active text-amber-800 dark:text-amber-300 font-semibold'
                : 'text-stone-600 dark:text-stone-300'
            }`}
          >
            Nhạc nền{ambientActiveCount > 0 ? ` (${ambientActiveCount})` : ''}
          </button>
        </div>

        <select
          aria-label="Chọn bộ máy phát âm thanh"
          value={engineMode}
          onChange={(e) => setEngineMode(e.target.value as 'gemini' | 'browser')}
          className="ios-liquid-pill px-3 py-1.5 text-[11px] font-medium rounded-full ios-liquid-bar border border-white/75 dark:border-zinc-700/60 text-stone-800 dark:text-stone-100 shrink-0"
        >
          <option value="gemini">AI Studio TTS</option>
          <option value="browser">Đọc nhanh Offline</option>
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
        {/* Prominent Story Character Prediction Action (always visible at top of voice studio) */}
        <div className="p-3.5 rounded-xl border border-amber-800/30 bg-amber-50/70 dark:bg-amber-950/25 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400 shrink-0" />
              <span className="truncate">Quét truyện dự đoán nhân vật</span>
            </div>
            <div className="text-[11px] text-stone-600 dark:text-stone-400 truncate mt-0.5">
              {analysis
                ? `Đã nhận diện ~${analysis.estimatedTotalCharacters} nhân vật · nhấn để chọn giọng`
                : 'AI tự dự đoán nhân vật & gợi ý giọng lồng tiếng'}
            </div>
          </div>
          <button
            type="button"
            disabled={isAnalyzing}
            onClick={handleAnalyzeStory}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-800 text-white text-[11px] font-medium hover:bg-amber-900 disabled:opacity-50 whitespace-nowrap shrink-0 min-h-[38px]"
          >
            {isAnalyzing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Users className="w-3.5 h-3.5" />
            )}
            <span>
              {isAnalyzing ? 'Đang quét...' : analysis ? 'Quét lại' : 'Quét dự đoán'}
            </span>
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300">
            {errorMsg}
          </div>
        )}

        {activeTab === 'ambient' && (
          <AmbientSoundPanel
            compact
            customTracks={customAmbientTracks}
            onAddCustomTrack={onAddCustomAmbientTrack}
            onDeleteCustomTrack={onDeleteCustomAmbientTrack}
          />
        )}

        {activeTab === 'characters' && (
          <div className="space-y-4">
            {/* Analyze Action + External Voice Upload */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/50 space-y-3">
              <div>
                <h3 className="font-semibold text-stone-900 dark:text-stone-100 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-amber-800 dark:text-amber-400" />
                  <span>Dự đoán nhân vật & chọn giọng lồng tiếng</span>
                </h3>
                <p className="text-[11px] text-stone-500 mt-0.5">
                  AI tách thoại nhân vật, gắn cảm xúc ({readingStyle === 'novel' ? 'hoảng hốt, mạnh mẽ, dịu dàng' : readingStyle === 'selfhelp' ? 'nhấn điểm trọng tâm học tập' : 'nhẹ nhàng truyền cảm'}) và gợi ý giọng riêng.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isAnalyzing}
                  onClick={handleAnalyzeStory}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-800 text-white font-medium hover:bg-amber-900 disabled:opacity-50 min-h-[40px]"
                >
                  {isAnalyzing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {isAnalyzing
                      ? 'Đang quét truyện...'
                      : analysis
                      ? 'Quét lại dự đoán nhân vật'
                      : 'Quét truyện dự đoán nhân vật'}
                  </span>
                </button>

                <input
                  ref={voiceFileRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.ogg,.m4a"
                  className="hidden"
                  onChange={(e) => handleImportVoiceFile(e.target.files)}
                />
                <button
                  type="button"
                  disabled={isAnalyzingVoice}
                  onClick={() => voiceFileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800 min-h-[40px]"
                >
                  {isAnalyzingVoice ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  <span>Import file voice ngoài</span>
                </button>
              </div>
            </div>

            {analysis && (
              <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-100/70 dark:bg-stone-900/60 space-y-1.5">
                <div className="flex items-center justify-between font-semibold text-stone-900 dark:text-stone-100">
                  <span>Ước lượng: ~{analysis.estimatedTotalCharacters} nhân vật</span>
                  <span className="tabular-nums text-[11px] text-stone-500">
                    {analysis.script.length} phân đoạn thoại
                  </span>
                </div>
                {analysis.summary && (
                  <p className="text-[11px] text-stone-600 dark:text-stone-400 leading-relaxed">
                    {analysis.summary}
                  </p>
                )}
              </div>
            )}

            {/* Character Cast List */}
            <div className="space-y-3">
              {(analysis?.characters && analysis.characters.length > 0
                ? analysis.characters
                : [
                    {
                      id: 'narrator',
                      name:
                        readingStyle === 'selfhelp' ? 'Diễn giả chính' : 'Người dẫn chuyện',
                      role: 'narrator' as const,
                      gender: 'neutral' as const,
                      ageGroup: 'Trưởng thành',
                      voiceDescription: STYLE_LABELS[readingStyle],
                      suggestedVoiceName: 'Kore' as GeminiVoiceName,
                      lineCount: chapter.paragraphs.length,
                      sampleQuote: chapter.paragraphs[0]?.slice(0, 110) || '',
                    },
                  ]
              ).map((char) => {
                const assign = getAssignment(char.id, char.suggestedVoiceName);
                const tone = assign.toneSettings || DEFAULT_VOICE_TONE;
                return (
                  <div
                    key={char.id}
                    className="p-3.5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/40 space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-sm text-stone-900 dark:text-stone-100">
                          {char.name}
                        </div>
                        <div className="text-[11px] text-stone-500 flex items-center gap-1.5">
                          <span>{ROLE_LABELS[char.role] || char.role}</span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{char.lineCount} đoạn</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          handlePreviewCharacter(char.id, char.sampleQuote || char.voiceDescription)
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 text-[11px] hover:bg-stone-100 dark:hover:bg-stone-800"
                      >
                        <Volume2 className="w-3 h-3" />
                        <span>{previewingId === char.id ? 'Đang phát...' : 'Nghe thử'}</span>
                      </button>
                    </div>

                    <p className="text-[11px] text-stone-600 dark:text-stone-400">
                      {char.voiceDescription}
                    </p>

                    <div className="grid grid-cols-3 gap-1 p-0.5 bg-stone-100 dark:bg-stone-800 rounded-md">
                      {(
                        [
                          { id: 'gemini', label: 'AI Studio' },
                          { id: 'external', label: `Voice (${externalVoices.length})` },
                          { id: 'browser', label: 'Offline' },
                        ] as Array<{ id: CharacterVoiceSource; label: string }>
                      ).map((src) => (
                        <button
                          key={src.id}
                          type="button"
                          onClick={() =>
                            onUpdateVoiceAssignment(char.id, { ...assign, source: src.id })
                          }
                          className={`py-1.5 rounded text-[11px] font-medium transition-colors ${
                            assign.source === src.id
                              ? 'bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 shadow-xs'
                              : 'text-stone-500'
                          }`}
                        >
                          {src.label}
                        </button>
                      ))}
                    </div>

                    {assign.source === 'gemini' && (
                      <div className="space-y-2">
                        <select
                          aria-label={`Chọn giọng AI cho ${char.name}`}
                          value={assign.geminiVoice}
                          onChange={(e) =>
                            onUpdateVoiceAssignment(char.id, {
                              ...assign,
                              geminiVoice: e.target.value as GeminiVoiceName,
                            })
                          }
                          className="w-full px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                        >
                          {GEMINI_VOICES.map((gv) => (
                            <option key={gv.name} value={gv.name}>
                              {gv.label} — {gv.tone}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={assign.stylePrompt}
                          onChange={(e) =>
                            onUpdateVoiceAssignment(char.id, {
                              ...assign,
                              stylePrompt: e.target.value,
                            })
                          }
                          placeholder="Chỉ dẫn cảm xúc (vd: hoảng hốt, hùng hồn, nhẹ nhàng)..."
                          className="w-full px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-[11px]"
                        />
                        <div className="flex flex-wrap gap-1">
                          {QUICK_EMOTION_PROMPTS.map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() =>
                                onUpdateVoiceAssignment(char.id, {
                                  ...assign,
                                  stylePrompt: preset,
                                })
                              }
                              className="px-2 py-0.5 rounded border border-stone-200 dark:border-stone-700 text-[10px] hover:border-amber-800"
                            >
                              {preset.split(',')[0]}
                            </button>
                          ))}
                        </div>

                        <label className="block space-y-0.5 pt-1">
                          <span className="text-[10px] text-stone-500 tabular-nums">
                            Độ ấm trầm (EQ): {tone.warmthDb >= 0 ? '+' : ''}
                            {tone.warmthDb} dB
                          </span>
                          <input
                            type="range"
                            min={-6}
                            max={12}
                            step={1}
                            value={tone.warmthDb}
                            onChange={(e) =>
                              onUpdateVoiceAssignment(char.id, {
                                ...assign,
                                toneSettings: { ...tone, warmthDb: Number(e.target.value) },
                              })
                            }
                            className="w-full accent-amber-800"
                          />
                        </label>
                      </div>
                    )}

                    {assign.source === 'external' && (
                      <div className="space-y-1.5">
                        {externalVoices.length === 0 ? (
                          <p className="text-[11px] text-amber-800 dark:text-amber-400">
                            Chưa có tệp giọng ngoài. Nhấn &ldquo;Import file voice ngoài&rdquo; hoặc vào Studio Giọng để tạo voice mới.
                          </p>
                        ) : (
                          <select
                            aria-label={`Chọn tệp giọng ngoài cho ${char.name}`}
                            value={assign.externalVoiceId || externalVoices[0]?.id || ''}
                            onChange={(e) =>
                              onUpdateVoiceAssignment(char.id, {
                                ...assign,
                                externalVoiceId: e.target.value,
                              })
                            }
                            className="w-full px-2.5 py-1.5 rounded-md border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs"
                          >
                            {externalVoices.map((ev) => (
                              <option key={ev.id} value={ev.id}>
                                {ev.name} ({ev.fileName})
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}

                    {assign.source === 'browser' && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-stone-500 tabular-nums">
                            Cao độ: {assign.browserPitch.toFixed(1)}
                          </span>
                          <input
                            type="range"
                            min={0.6}
                            max={1.6}
                            step={0.1}
                            value={assign.browserPitch}
                            onChange={(e) =>
                              onUpdateVoiceAssignment(char.id, {
                                ...assign,
                                browserPitch: Number(e.target.value),
                              })
                            }
                            className="w-full accent-amber-800"
                          />
                        </label>
                        <label className="space-y-0.5">
                          <span className="text-[10px] text-stone-500 tabular-nums">
                            Tốc độ: {assign.browserRate.toFixed(1)}x
                          </span>
                          <input
                            type="range"
                            min={0.7}
                            max={1.5}
                            step={0.1}
                            value={assign.browserRate}
                            onChange={(e) =>
                              onUpdateVoiceAssignment(char.id, {
                                ...assign,
                                browserRate: Number(e.target.value),
                              })
                            }
                            className="w-full accent-amber-800"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'player' && (
          <div className="space-y-4">
            {/* Transport Card */}
            <div className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/60 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-stone-500 tabular-nums">
                  Đoạn {currentSegIndex + 1} / {effectiveScript.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-stone-500">Tốc độ</span>
                  <select
                    aria-label="Tốc độ phát sách nói"
                    value={playbackSpeed}
                    onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                    className="px-2 py-1 rounded border border-stone-300 dark:border-stone-700 bg-transparent text-[11px] tabular-nums"
                  >
                    <option value={0.75}>0.75x</option>
                    <option value={1}>1.0x</option>
                    <option value={1.25}>1.25x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={1.75}>1.75x</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-center gap-4">
                <button
                  type="button"
                  onClick={() => {
                    const prev = Math.max(0, currentSegIndex - 1);
                    setCurrentSegIndex(prev);
                    if (isPlaying) {
                      stopAllAudio();
                      isPlayingRef.current = true;
                      setIsPlaying(true);
                      playSegmentAt(prev);
                    }
                  }}
                  aria-label="Đoạn trước"
                  className="p-2.5 rounded-full border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <SkipBack className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? 'Tạm dừng sách nói' : 'Phát sách nói AI'}
                  className="w-12 h-12 rounded-full bg-amber-800 text-white flex items-center justify-center hover:bg-amber-900 transition-colors"
                >
                  {isLoadingAudio ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-5 h-5" />
                  ) : (
                    <Play className="w-5 h-5 ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = Math.min(effectiveScript.length - 1, currentSegIndex + 1);
                    setCurrentSegIndex(next);
                    if (isPlaying) {
                      stopAllAudio();
                      isPlayingRef.current = true;
                      setIsPlaying(true);
                      playSegmentAt(next);
                    }
                  }}
                  aria-label="Đoạn tiếp theo"
                  className="p-2.5 rounded-full border border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800"
                >
                  <SkipForward className="w-4 h-4" />
                </button>

                {isPlaying && (
                  <button
                    type="button"
                    onClick={stopAllAudio}
                    aria-label="Dừng hẳn sách nói"
                    className="p-2.5 rounded-full border border-stone-300 dark:border-stone-700 text-stone-600 hover:text-red-600"
                  >
                    <Square className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={handleAnalyzeStory}
                  disabled={isAnalyzing}
                  className="inline-flex items-center gap-1 text-[11px] text-stone-600 dark:text-stone-400 hover:text-amber-800"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{isAnalyzing ? 'Đang dự đoán...' : 'Quét truyện dự đoán nhân vật'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopAllAudio();
                    onNextChapter();
                  }}
                  className="text-[11px] text-amber-800 dark:text-amber-400 hover:underline"
                >
                  Chương tiếp →
                </button>
              </div>
            </div>

            {/* Dialogue Script Queue */}
            <div className="space-y-2">
              <h3 className="font-semibold text-stone-700 dark:text-stone-300">
                Kịch bản & Vị trí đọc ({effectiveScript.length} đoạn)
              </h3>
              <div className="space-y-2">
                {effectiveScript.map((seg, idx) => {
                  const active = idx === currentSegIndex;
                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => {
                        setCurrentSegIndex(idx);
                        onHighlightParagraph(seg.paragraphIndex, 0.1);
                        onSyncReadingParagraph?.(seg.paragraphIndex);
                        if (isPlaying) {
                          stopAllAudio();
                          isPlayingRef.current = true;
                          setIsPlaying(true);
                          playSegmentAt(idx);
                        }
                      }}
                      className={`w-full text-left p-3 rounded-lg border transition-colors ${
                        active
                          ? 'border-amber-700 bg-amber-50/90 dark:bg-amber-950/30'
                          : 'border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900/30 hover:border-stone-400'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-semibold mb-1">
                        <span className="text-amber-900 dark:text-amber-400">
                          {seg.speakerName}
                        </span>
                        <span className="text-stone-400 font-normal truncate max-w-[180px]">
                          {seg.emotionStyle}
                        </span>
                      </div>
                      <p className="text-xs text-stone-700 dark:text-stone-300 line-clamp-3 leading-relaxed">
                        {seg.text}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
