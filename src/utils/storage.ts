import type {
  AppBasicSettings,
  Book,
  CustomAmbientTrack,
  CustomFontAsset,
  ExternalVoiceAsset,
  ReaderSettings,
  ReadingLogEntry,
  UserCollection,
} from '../types/book';
import { createSeedBooks } from '../data/seedBooks';
import { computeBookFingerprint, createSeedReadingLogs } from './syncAndStats';

const DB_NAME = 'laziread_studio_db';
const DB_VERSION = 2;
const STORE_BOOKS = 'books';
const STORE_FONTS = 'custom_fonts';
const STORE_VOICES = 'external_voices';
const STORE_AMBIENT_TRACKS = 'custom_ambient_tracks';
const STORE_META = 'meta';

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: "'Lora', Georgia, serif",
  fontSize: 19,
  lineHeight: 1.8,
  paragraphSpacing: 18,
  letterSpacing: 0,
  fontWeight: 400,
  pageWidth: 'medium',
  textAlign: 'justify',
  dropCap: true,
  firstLineIndent: false,
  paperTheme: 'alabaster',
  customBgColor: '#F7F4EE',
  customTextColor: '#1C1917',
  brightness: 100,
  warmth: 0,
  readingMode: 'scroll',
  pageTurnStyle: 'curl',
  columnsInPaginated: 1,
  autoScrollSpeed: 0,
  translationMode: 'original',
  targetLang: 'vi',
};

export const DEFAULT_APP_BASIC_SETTINGS: AppBasicSettings = {
  uiTheme: 'light',
  tapToTurnPage: true,
  keepScreenAwake: false,
  autoResumeLastBook: false,
  defaultReadingStyle: 'novel',
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BOOKS)) {
        db.createObjectStore(STORE_BOOKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_FONTS)) {
        db.createObjectStore(STORE_FONTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_VOICES)) {
        db.createObjectStore(STORE_VOICES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_AMBIENT_TRACKS)) {
        db.createObjectStore(STORE_AMBIENT_TRACKS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAllFromStore<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function putToStore<T>(storeName: string, item: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteFromStore(storeName: string, id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function normalizeBook(book: Book): Book {
  return {
    ...book,
    fingerprint: book.fingerprint || computeBookFingerprint(book),
    collection: book.collection || (book.sourceType === 'web' ? 'Sưu tầm Web' : 'Chưa phân loại'),
    readingStyle: book.readingStyle || 'novel',
  };
}

export async function loadBooks(): Promise<Book[]> {
  try {
    const existing = await getAllFromStore<Book>(STORE_BOOKS);
    if (existing.length > 0) {
      return existing.map(normalizeBook).sort((a, b) => b.lastReadAt - a.lastReadAt);
    }
    const metaSeed = await getMetaValue<boolean>('seeded');
    if (!metaSeed) {
      const seeds = createSeedBooks();
      for (const b of seeds) {
        await putToStore(STORE_BOOKS, b);
      }
      await setMetaValue('seeded', true);
      return seeds;
    }
    return [];
  } catch {
    return createSeedBooks();
  }
}

export async function saveBook(book: Book): Promise<void> {
  await putToStore(STORE_BOOKS, normalizeBook(book));
}

export async function saveAllBooks(books: Book[]): Promise<void> {
  for (const b of books) {
    await putToStore(STORE_BOOKS, normalizeBook(b));
  }
}

export async function removeBook(bookId: string): Promise<void> {
  await deleteFromStore(STORE_BOOKS, bookId);
}

export async function restoreSampleBooks(): Promise<Book[]> {
  const seeds = createSeedBooks();
  for (const b of seeds) {
    await putToStore(STORE_BOOKS, b);
  }
  await setMetaValue('seeded', true);
  return loadBooks();
}

export async function loadCustomFonts(): Promise<CustomFontAsset[]> {
  try {
    const fonts = await getAllFromStore<CustomFontAsset>(STORE_FONTS);
    for (const font of fonts) {
      await registerFontFaceInBrowser(font);
    }
    return fonts.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveCustomFont(font: CustomFontAsset): Promise<void> {
  await registerFontFaceInBrowser(font);
  await putToStore(STORE_FONTS, font);
}

export async function removeCustomFont(fontId: string): Promise<void> {
  await deleteFromStore(STORE_FONTS, fontId);
}

export async function registerFontFaceInBrowser(font: CustomFontAsset): Promise<void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return;
  try {
    const alreadyLoaded = Array.from(document.fonts).some(
      (f) => f.family === font.fontFamily || f.family === `"${font.fontFamily}"`
    );
    if (alreadyLoaded) return;
    const face = new FontFace(font.fontFamily, `url(${font.dataUrl})`);
    const loaded = await face.load();
    document.fonts.add(loaded);
  } catch (err) {
    console.warn('Could not register custom font:', font.name, err);
  }
}

export async function loadExternalVoices(): Promise<ExternalVoiceAsset[]> {
  try {
    const voices = await getAllFromStore<ExternalVoiceAsset>(STORE_VOICES);
    return voices.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveExternalVoice(voice: ExternalVoiceAsset): Promise<void> {
  await putToStore(STORE_VOICES, voice);
}

export async function removeExternalVoice(voiceId: string): Promise<void> {
  await deleteFromStore(STORE_VOICES, voiceId);
}

export async function loadCustomAmbientTracks(): Promise<CustomAmbientTrack[]> {
  try {
    const tracks = await getAllFromStore<CustomAmbientTrack>(STORE_AMBIENT_TRACKS);
    return tracks.sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function saveCustomAmbientTrack(track: CustomAmbientTrack): Promise<void> {
  await putToStore(STORE_AMBIENT_TRACKS, track);
}

export async function removeCustomAmbientTrack(trackId: string): Promise<void> {
  await deleteFromStore(STORE_AMBIENT_TRACKS, trackId);
}

export async function loadReadingLogs(): Promise<ReadingLogEntry[]> {
  try {
    const logs = await getMetaValue<ReadingLogEntry[]>('reading_logs');
    if (Array.isArray(logs) && logs.length > 0) {
      return logs;
    }
    const seedLogs = createSeedReadingLogs();
    await setMetaValue('reading_logs', seedLogs);
    return seedLogs;
  } catch {
    return createSeedReadingLogs();
  }
}

export async function saveReadingLogs(logs: ReadingLogEntry[]): Promise<void> {
  try {
    await setMetaValue('reading_logs', logs);
  } catch {
    // Ignore storage errors
  }
}

export async function loadUserCollections(): Promise<UserCollection[]> {
  try {
    const cols = await getMetaValue<UserCollection[]>('user_collections');
    if (Array.isArray(cols)) {
      return cols;
    }
    const fallback = localStorage.getItem('laziread_user_collections');
    if (fallback) {
      const parsed = JSON.parse(fallback);
      if (Array.isArray(parsed)) return parsed;
    }
    return [];
  } catch {
    try {
      const fallback = localStorage.getItem('laziread_user_collections');
      if (fallback) {
        const parsed = JSON.parse(fallback);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  }
}

export async function saveUserCollections(collections: UserCollection[]): Promise<void> {
  try {
    localStorage.setItem('laziread_user_collections', JSON.stringify(collections));
  } catch {
    // Ignore quota errors
  }
  try {
    await setMetaValue('user_collections', collections);
  } catch {
    // Ignore storage errors
  }
}

async function getMetaValue<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_META, 'readonly');
    const req = tx.objectStore(STORE_META).get(key);
    req.onsuccess = () => resolve(req.result?.value as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function setMetaValue<T>(key: string, value: T): Promise<void> {
  await putToStore(STORE_META, { key, value });
}

export function loadReaderSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem('laziread_reader_settings');
    if (!raw) return DEFAULT_READER_SETTINGS;
    return { ...DEFAULT_READER_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_READER_SETTINGS;
  }
}

export function saveReaderSettings(settings: ReaderSettings): void {
  try {
    localStorage.setItem('laziread_reader_settings', JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadAppBasicSettings(): AppBasicSettings {
  try {
    const raw = localStorage.getItem('laziread_basic_settings');
    if (!raw) return DEFAULT_APP_BASIC_SETTINGS;
    return { ...DEFAULT_APP_BASIC_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_APP_BASIC_SETTINGS;
  }
}

export function saveAppBasicSettings(settings: AppBasicSettings): void {
  try {
    localStorage.setItem('laziread_basic_settings', JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}
