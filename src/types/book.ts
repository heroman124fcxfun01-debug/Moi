export type BookSourceType = 'epub' | 'pdf' | 'image' | 'web' | 'sample';

export type BookReadingStyle = 'novel' | 'selfhelp' | 'essay' | 'research';

export type TranslationMode = 'original' | 'override' | 'bilingual';

export type PaperThemeId =
  | 'alabaster'
  | 'pure'
  | 'sepia'
  | 'vintage_yellow'
  | 'parchment'
  | 'newsprint'
  | 'amber_aged'
  | 'sage'
  | 'charcoal'
  | 'oled'
  | 'custom';

export type ReadingMode = 'scroll' | 'paginated';
export type PageTurnStyle = 'curl' | 'slide' | 'flip3d' | 'cover' | 'fade' | 'none';
export type PageWidthOption = 'narrow' | 'medium' | 'wide' | 'full';
export type TextAlignOption = 'justify' | 'left';

export type GeminiVoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export type CharacterVoiceSource = 'gemini' | 'browser' | 'external';

export interface VoiceToneSettings {
  warmthDb: number; // -6 to +12 dB (low-shelf bass warmth)
  clarityDb: number; // -6 to +10 dB (high-shelf articulation)
  pitch: number; // 0.6 to 1.5
  rate: number; // 0.7 to 1.6
  styleDirection: string;
}

export interface CharacterVoiceAssignment {
  characterId: string;
  source: CharacterVoiceSource;
  geminiVoice: GeminiVoiceName;
  stylePrompt: string;
  browserVoiceURI?: string;
  browserPitch: number;
  browserRate: number;
  externalVoiceId?: string;
  toneSettings?: VoiceToneSettings;
}

export interface CharacterInfo {
  id: string;
  name: string;
  role: 'narrator' | 'protagonist' | 'supporting' | 'antagonist';
  gender: 'male' | 'female' | 'neutral';
  ageGroup: string;
  voiceDescription: string;
  suggestedVoiceName: GeminiVoiceName;
  lineCount: number;
  sampleQuote: string;
}

export interface ScriptSegment {
  id: string;
  paragraphIndex: number;
  speakerId: string;
  speakerName: string;
  emotionStyle: string;
  text: string;
}

export interface ChapterAnalysis {
  estimatedTotalCharacters: number;
  readingStyle?: BookReadingStyle;
  summary: string;
  characters: CharacterInfo[];
  script: ScriptSegment[];
  analyzedAt: number;
}

export interface TranslationCacheEntry {
  targetLang: string;
  paragraphs: string[];
  translatedAt: number;
}

export interface Chapter {
  id: string;
  index: number;
  title: string;
  paragraphs: string[];
  translations?: Record<string, TranslationCacheEntry>;
  analysis?: ChapterAnalysis;
  sourceUrl?: string;
}

export interface BookmarkItem {
  id: string;
  chapterId: string;
  chapterTitle: string;
  paragraphIndex: number;
  excerpt: string;
  createdAt: number;
}

export interface HighlightItem {
  id: string;
  chapterId: string;
  paragraphIndex: number;
  text: string;
  note?: string;
  color: 'amber' | 'emerald' | 'rose' | 'sky';
  createdAt: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  description: string;
  language: string;
  sourceType: BookSourceType;
  collection?: string;
  readingStyle?: BookReadingStyle;
  fingerprint?: string;
  coverUrl?: string;
  chapters: Chapter[];
  currentChapterIndex: number;
  currentParagraphIndex: number;
  currentSentenceIndex?: number;
  progressPercent: number;
  bookmarks: BookmarkItem[];
  highlights: HighlightItem[];
  voiceAssignments: Record<string, CharacterVoiceAssignment>;
  addedAt: number;
  lastReadAt: number;
  sourceUrl?: string;
}

export interface CustomFontAsset {
  id: string;
  name: string;
  fontFamily: string;
  fileName: string;
  format: string;
  dataUrl: string;
  addedAt: number;
}

export interface ExternalVoiceAsset {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  durationSec?: number;
  toneSettings?: VoiceToneSettings;
  analyzedProfile?: {
    description: string;
    stylePrompt: string;
    recommendedBaseVoice: GeminiVoiceName;
    pitchHint: number;
    rateHint: number;
    transcriptPreview?: string;
  };
  addedAt: number;
}

export interface ReaderSettings {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  letterSpacing: number;
  fontWeight: number;
  pageWidth: PageWidthOption;
  textAlign: TextAlignOption;
  dropCap: boolean;
  firstLineIndent: boolean;
  paperTheme: PaperThemeId;
  customBgColor: string;
  customTextColor: string;
  brightness: number;
  warmth: number;
  readingMode: ReadingMode;
  pageTurnStyle: PageTurnStyle;
  columnsInPaginated: 1 | 2;
  autoScrollSpeed: number;
  translationMode: TranslationMode;
  targetLang: string;
}

export interface AppBasicSettings {
  uiTheme: 'light' | 'dark' | 'amoled';
  tapToTurnPage: boolean;
  keepScreenAwake: boolean;
  autoResumeLastBook: boolean;
  defaultReadingStyle: BookReadingStyle;
}

export interface ReadingLogEntry {
  date: string; // YYYY-MM-DD
  seconds: number;
  booksReadIds: string[];
}

export interface BookProgressSnapshot {
  id: string;
  fingerprint: string;
  title: string;
  author: string;
  collection?: string;
  readingStyle?: BookReadingStyle;
  currentChapterIndex: number;
  currentParagraphIndex: number;
  currentSentenceIndex?: number;
  progressPercent: number;
  bookmarks: BookmarkItem[];
  highlights: HighlightItem[];
  lastReadAt: number;
}

export interface SyncBackupBundle {
  version: number;
  exportedAt: number;
  deviceLabel: string;
  progressRecords: BookProgressSnapshot[];
  readingLogs: ReadingLogEntry[];
  fullBooks?: Book[];
}

export interface ScrapedChapterDraft {
  id: string;
  url: string;
  title: string;
  paragraphs: string[];
  wordCount: number;
  nextUrl: string | null;
  nextLabel: string | null;
  interactiveLinks?: Array<{ label: string; selector: string; href: string | null }>;
  paywallHint?: string;
  scrapedAt: number;
}

export interface UserCollection {
  id: string;
  name: string;
  bookIds: string[];
  createdAt: number;
}

export type AmbientSoundCategory = 'nature' | 'space' | 'chill';

export interface AmbientSoundPreset {
  id: string;
  name: string;
  description: string;
  category: AmbientSoundCategory;
  emoji: string;
  defaultVolume: number;
}

export interface CustomAmbientTrack {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  addedAt: number;
}


