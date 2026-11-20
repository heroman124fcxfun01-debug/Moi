import type {
  Book,
  ReadingLogEntry,
  SyncBackupBundle,
  UserCollection,
} from '../types/book';
import { buildEpubBlob, parseEpubBuffer } from './epubBuilder';
import {
  computeBookFingerprint,
  mergeProgressBundlesForCloudPush,
  mergeReadingLogs,
  mergeSyncBundleIntoLibrary,
  normalizeBookMatchKey,
} from './syncAndStats';

export const DRIVE_ROOT_FOLDER = 'sáchlazy';
export const DRIVE_SINGLE_BOOKS_FOLDER = 'sách lẻ';
export const DRIVE_PROGRESS_FILE = 'laziread-progress.lazisync.json';
export const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DRIVE_EPUB_MIME = 'application/epub+zip';

export interface DriveItemRef {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

export interface PlannedBookUpload {
  book: Book;
  fileName: string;
  targetFolderName: string;
  targetFolderId: string;
  existingFileId?: string;
  existingModifiedTime?: string;
}

export interface DuplicateScanResult {
  allItems: PlannedBookUpload[];
  duplicates: PlannedBookUpload[];
  freshItems: PlannedBookUpload[];
}

export interface DriveCollectionFolderInfo {
  folderId: string;
  name: string;
  files: DriveItemRef[];
}

export interface DownloadedBookEntry {
  book: Book;
  collectionName?: string;
}

/**
 * Produces a clean, human-readable .epub filename safe for Google Drive & cross-OS downloads.
 */
export function buildDriveBookFileName(book: Pick<Book, 'title'>): string {
  const clean = (book.title || 'Sach-LaziRead')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${clean || 'Sach-LaziRead'}.epub`;
}

/**
 * Groups books strictly by UserCollections created by the user in the Library.
 * Does NOT auto-create collections from default book genre/category tags.
 */
export function groupBooksForCollectionUpload(
  books: Book[],
  collections: UserCollection[]
): Array<{ collectionId: string; name: string; books: Book[] }> {
  const byId = new Map(books.map((b) => [b.id, b]));
  const result: Array<{ collectionId: string; name: string; books: Book[] }> = [];

  for (const col of collections) {
    const cleanName = col.name.trim();
    if (!cleanName || cleanName.toLowerCase() === DRIVE_SINGLE_BOOKS_FOLDER.toLowerCase()) {
      continue;
    }
    const members = col.bookIds
      .map((id) => byId.get(id))
      .filter((b): b is Book => Boolean(b));
    result.push({ collectionId: col.id, name: cleanName, books: members });
  }

  return result;
}

/**
 * Pure duplicate detector matching planned book uploads against existing files in a Drive folder.
 */
export function detectDuplicateFiles(
  planned: Array<{ book: Book; targetFolderName: string; targetFolderId: string }>,
  existingByFolderId: Record<string, DriveItemRef[]>
): DuplicateScanResult {
  const allItems: PlannedBookUpload[] = [];
  const duplicates: PlannedBookUpload[] = [];
  const freshItems: PlannedBookUpload[] = [];

  for (const item of planned) {
    const fileName = buildDriveBookFileName(item.book);
    const existingList = existingByFolderId[item.targetFolderId] || [];
    const match = existingList.find(
      (f) => f.mimeType !== DRIVE_FOLDER_MIME && f.name.toLowerCase() === fileName.toLowerCase()
    );

    const record: PlannedBookUpload = {
      book: item.book,
      fileName,
      targetFolderName: item.targetFolderName,
      targetFolderId: item.targetFolderId,
      existingFileId: match?.id,
      existingModifiedTime: match?.modifiedTime,
    };

    allItems.push(record);
    if (match) {
      duplicates.push(record);
    } else {
      freshItems.push(record);
    }
  }

  return { allItems, duplicates, freshItems };
}

/**
 * Pure merge helper: merges downloaded books from Google Drive into local library,
 * restores reading progress from the Drive sync bundle, and auto-creates matching
 * UserCollection folders with the exact Drive folder names.
 */
export function mergeDownloadedDriveBooks(
  localBooks: Book[],
  localCollections: UserCollection[],
  downloadedEntries: DownloadedBookEntry[],
  progressBundle: SyncBackupBundle | null,
  localLogs: ReadingLogEntry[]
): {
  mergedBooks: Book[];
  mergedCollections: UserCollection[];
  mergedLogs: ReadingLogEntry[];
  addedBooksCount: number;
  updatedProgressCount: number;
  createdCollectionsCount: number;
} {
  let workingBooks: Book[] = localBooks.map((b) => ({
    ...b,
    fingerprint: b.fingerprint || computeBookFingerprint(b),
  }));
  const workingCols = localCollections.map((c) => ({ ...c, bookIds: [...c.bookIds] }));

  let addedBooksCount = 0;
  let createdCollectionsCount = 0;

  const ensureCollection = (name: string): UserCollection => {
    const existing = workingCols.find(
      (c) => c.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (existing) return existing;
    const created: UserCollection = {
      id: `col-drive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      bookIds: [],
      createdAt: Date.now(),
    };
    workingCols.push(created);
    createdCollectionsCount += 1;
    return created;
  };

  for (const entry of downloadedEntries) {
    const fp = entry.book.fingerprint || computeBookFingerprint(entry.book);
    const incomingKey = normalizeBookMatchKey(entry.book.title);
    const existingIdx = workingBooks.findIndex(
      (b) =>
        (b.fingerprint || computeBookFingerprint(b)) === fp ||
        (incomingKey && normalizeBookMatchKey(b.title) === incomingKey) ||
        b.title.trim().toLowerCase() === entry.book.title.trim().toLowerCase()
    );

    let finalBookId: string;
    if (existingIdx >= 0) {
      finalBookId = workingBooks[existingIdx].id;
      if (entry.collectionName && !workingBooks[existingIdx].collection) {
        workingBooks[existingIdx] = {
          ...workingBooks[existingIdx],
          collection: entry.collectionName,
        };
      }
    } else {
      const newBook: Book = {
        ...entry.book,
        fingerprint: fp,
        collection: entry.collectionName || entry.book.collection,
      };
      workingBooks = [newBook, ...workingBooks];
      finalBookId = newBook.id;
      addedBooksCount += 1;
    }

    if (entry.collectionName) {
      const col = ensureCollection(entry.collectionName);
      if (!col.bookIds.includes(finalBookId)) {
        col.bookIds.push(finalBookId);
      }
    }
  }

  let updatedProgressCount = 0;
  let mergedLogs = localLogs;

  if (progressBundle) {
    const mergeRes = mergeSyncBundleIntoLibrary(workingBooks, {
      ...progressBundle,
      fullBooks: undefined, // Books already downloaded from .epub folders
    });
    workingBooks = mergeRes.mergedBooks;
    updatedProgressCount = mergeRes.matchedProgressCount;
    mergedLogs = mergeReadingLogs(localLogs, progressBundle.readingLogs || []);
  }

  return {
    mergedBooks: workingBooks,
    mergedCollections: workingCols,
    mergedLogs,
    addedBooksCount,
    updatedProgressCount,
    createdCollectionsCount,
  };
}

// ============================================================================
// Google Drive v3 REST API Client
// ============================================================================

function escapeDriveQuery(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function driveJsonFetch<T>(
  url: string,
  token: string,
  init: RequestInit = {}
): Promise<T> {
  const resp = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (resp.status === 401) {
    throw new Error('Phiên đăng nhập Google Drive đã hết hạn. Vui lòng bấm Đăng nhập lại.');
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Lỗi Google Drive (HTTP ${resp.status}): ${text.slice(0, 180)}`);
  }
  return (await resp.json()) as T;
}

export async function findDriveItemByName(
  token: string,
  name: string,
  parentId?: string,
  mimeType?: string
): Promise<DriveItemRef | null> {
  const parts = [`name = '${escapeDriveQuery(name)}'`, 'trashed = false'];
  if (parentId) {
    parts.push(`'${escapeDriveQuery(parentId)}' in parents`);
  } else {
    parts.push(`'root' in parents`);
  }
  if (mimeType) {
    parts.push(`mimeType = '${escapeDriveQuery(mimeType)}'`);
  }
  const q = encodeURIComponent(parts.join(' and '));
  const data = await driveJsonFetch<{ files?: DriveItemRef[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,modifiedTime,size)&spaces=drive`,
    token
  );
  return data.files?.[0] || null;
}

export async function ensureDriveFolder(
  token: string,
  folderName: string,
  parentId?: string
): Promise<DriveItemRef> {
  const existing = await findDriveItemByName(token, folderName, parentId, DRIVE_FOLDER_MIME);
  if (existing) return existing;

  const metadata: Record<string, unknown> = {
    name: folderName,
    mimeType: DRIVE_FOLDER_MIME,
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  return driveJsonFetch<DriveItemRef>(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,modifiedTime',
    token,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    }
  );
}

export async function listDriveFolderItems(
  token: string,
  folderId: string
): Promise<DriveItemRef[]> {
  const q = encodeURIComponent(`'${escapeDriveQuery(folderId)}' in parents and trashed = false`);
  const data = await driveJsonFetch<{ files?: DriveItemRef[] }>(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=200&fields=files(id,name,mimeType,modifiedTime,size)&orderBy=name`,
    token
  );
  return data.files || [];
}

export async function uploadMultipartDriveFile(
  token: string,
  opts: {
    name: string;
    mimeType: string;
    blob: Blob;
    parentId: string;
    existingFileId?: string;
  }
): Promise<DriveItemRef> {
  const metadata: Record<string, unknown> = {
    name: opts.name,
    mimeType: opts.mimeType,
  };
  if (!opts.existingFileId) {
    metadata.parents = [opts.parentId];
  }

  const form = new FormData();
  form.append(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json; charset=UTF-8' })
  );
  form.append('file', opts.blob, opts.name);

  const endpoint = opts.existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(opts.existingFileId)}?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size';

  return driveJsonFetch<DriveItemRef>(endpoint, token, {
    method: opts.existingFileId ? 'PATCH' : 'POST',
    body: form,
  });
}

export async function downloadDriveFileBuffer(
  token: string,
  fileId: string
): Promise<ArrayBuffer> {
  const resp = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (resp.status === 401) {
    throw new Error('Phiên đăng nhập Google Drive đã hết hạn. Vui lòng đăng nhập lại.');
  }
  if (!resp.ok) {
    throw new Error(`Không thể tải tệp từ Google Drive (HTTP ${resp.status}).`);
  }
  return resp.arrayBuffer();
}

export async function ensureLaziRootFolder(token: string): Promise<DriveItemRef> {
  return ensureDriveFolder(token, DRIVE_ROOT_FOLDER);
}

export async function uploadProgressManifestToDrive(
  token: string,
  books: Book[],
  readingLogs: ReadingLogEntry[],
  preloadedRemote?: SyncBackupBundle | null
): Promise<DriveItemRef> {
  const root = await ensureLaziRootFolder(token);
  const existing = await findDriveItemByName(token, DRIVE_PROGRESS_FILE, root.id);
  let remoteBundle = preloadedRemote;
  if (remoteBundle === undefined && existing) {
    try {
      const buf = await downloadDriveFileBuffer(token, existing.id);
      const text = new TextDecoder('utf-8').decode(buf);
      const parsed = JSON.parse(text) as SyncBackupBundle;
      if (parsed && Array.isArray(parsed.progressRecords)) {
        remoteBundle = parsed;
      }
    } catch {
      remoteBundle = null;
    }
  }
  const bundle = mergeProgressBundlesForCloudPush(
    books,
    readingLogs,
    remoteBundle ?? null,
    'LaziRead Google Drive'
  );
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
  return uploadMultipartDriveFile(token, {
    name: DRIVE_PROGRESS_FILE,
    mimeType: 'application/json',
    blob,
    parentId: root.id,
    existingFileId: existing?.id,
  });
}

export async function downloadProgressManifestFromDrive(
  token: string,
  rootFolderId: string
): Promise<SyncBackupBundle | null> {
  const file = await findDriveItemByName(token, DRIVE_PROGRESS_FILE, rootFolderId);
  if (!file) return null;
  const buf = await downloadDriveFileBuffer(token, file.id);
  const text = new TextDecoder('utf-8').decode(buf);
  const parsed = JSON.parse(text) as SyncBackupBundle;
  return parsed && Array.isArray(parsed.progressRecords) ? parsed : null;
}

/**
 * Bidirectional auto-sync on connect / reconnect / reading update:
 * 1) Pulls remote manifest -> updates ONLY books already imported on this device (matching by ID, fingerprint, or normalized filename/title).
 * 2) Pushes merged manifest -> updates Drive without erasing progress of books stored only on other devices.
 */
export async function syncProgressTwoWayWithDrive(
  token: string,
  localBooks: Book[],
  localLogs: ReadingLogEntry[]
): Promise<{
  mergedBooks: Book[];
  mergedLogs: ReadingLogEntry[];
  matchedProgressCount: number;
}> {
  const root = await ensureLaziRootFolder(token);
  const remoteBundle = await downloadProgressManifestFromDrive(token, root.id);

  let workingBooks = localBooks;
  let workingLogs = localLogs;
  let matchedProgressCount = 0;

  if (remoteBundle) {
    const mergeRes = mergeSyncBundleIntoLibrary(localBooks, {
      ...remoteBundle,
      fullBooks: undefined,
    });
    workingBooks = mergeRes.mergedBooks;
    workingLogs = mergeReadingLogs(localLogs, remoteBundle.readingLogs || []);
    matchedProgressCount = mergeRes.matchedProgressCount;
  }

  await uploadProgressManifestToDrive(token, workingBooks, workingLogs, remoteBundle);
  return {
    mergedBooks: workingBooks,
    mergedLogs: workingLogs,
    matchedProgressCount,
  };
}

/**
 * Step 1 of uploading collections: prepares folders inside `sáchlazy/<Tên bộ sưu tập>`
 * and detects any duplicate .epub files so the UI can warn the user before overwriting.
 */
export async function scanUploadCollectionsPlan(
  token: string,
  books: Book[],
  collections: UserCollection[],
  selectedCollectionIds?: string[]
): Promise<DuplicateScanResult> {
  const root = await ensureLaziRootFolder(token);
  const grouped = groupBooksForCollectionUpload(books, collections).filter(
    (g) =>
      g.books.length > 0 &&
      (!selectedCollectionIds || selectedCollectionIds.includes(g.collectionId))
  );

  const planned: Array<{ book: Book; targetFolderName: string; targetFolderId: string }> = [];
  const existingByFolderId: Record<string, DriveItemRef[]> = {};

  for (const group of grouped) {
    const colFolder = await ensureDriveFolder(token, group.name, root.id);
    if (!existingByFolderId[colFolder.id]) {
      existingByFolderId[colFolder.id] = await listDriveFolderItems(token, colFolder.id);
    }
    for (const book of group.books) {
      planned.push({
        book,
        targetFolderName: `${DRIVE_ROOT_FOLDER}/${group.name}`,
        targetFolderId: colFolder.id,
      });
    }
  }

  return detectDuplicateFiles(planned, existingByFolderId);
}

/**
 * Step 1 of uploading individual books: prepares `sáchlazy/sách lẻ`
 * and checks for duplicate filenames before writing.
 */
export async function scanUploadSingleBooksPlan(
  token: string,
  selectedBooks: Book[]
): Promise<DuplicateScanResult> {
  const root = await ensureLaziRootFolder(token);
  const singleFolder = await ensureDriveFolder(token, DRIVE_SINGLE_BOOKS_FOLDER, root.id);
  const existing = await listDriveFolderItems(token, singleFolder.id);

  const planned = selectedBooks.map((book) => ({
    book,
    targetFolderName: `${DRIVE_ROOT_FOLDER}/${DRIVE_SINGLE_BOOKS_FOLDER}`,
    targetFolderId: singleFolder.id,
  }));

  return detectDuplicateFiles(planned, { [singleFolder.id]: existing });
}

/**
 * Executes a planned upload with explicit user decision on duplicates ('overwrite' | 'skip').
 */
export async function executePlannedUploads(
  token: string,
  plan: DuplicateScanResult,
  duplicateAction: 'overwrite' | 'skip',
  allBooks: Book[],
  readingLogs: ReadingLogEntry[],
  onProgress?: (msg: string) => void
): Promise<{ uploadedCount: number; overwrittenCount: number; skippedCount: number }> {
  let uploadedCount = 0;
  let overwrittenCount = 0;
  let skippedCount = 0;

  const total = plan.allItems.length;
  for (let i = 0; i < total; i++) {
    const item = plan.allItems[i];
    if (item.existingFileId && duplicateAction === 'skip') {
      skippedCount += 1;
      continue;
    }

    onProgress?.(
      `Đang tải (${i + 1}/${total}): ${item.fileName} → ${item.targetFolderName}...`
    );
    const epubBlob = await buildEpubBlob(item.book);
    await uploadMultipartDriveFile(token, {
      name: item.fileName,
      mimeType: DRIVE_EPUB_MIME,
      blob: epubBlob,
      parentId: item.targetFolderId,
      existingFileId: item.existingFileId,
    });
    if (item.existingFileId) {
      overwrittenCount += 1;
    } else {
      uploadedCount += 1;
    }
  }

  onProgress?.('Đang cập nhật tệp tiến độ đọc lên sáchlazy...');
  await uploadProgressManifestToDrive(token, allBooks, readingLogs);

  return { uploadedCount, overwrittenCount, skippedCount };
}

/**
 * Lists all collection folders and single books currently stored inside `sáchlazy` on Google Drive.
 */
export async function inspectDriveLibraryContents(token: string): Promise<{
  rootFolderId: string | null;
  collections: DriveCollectionFolderInfo[];
  singleBooks: DriveItemRef[];
  hasProgressFile: boolean;
}> {
  const root = await findDriveItemByName(token, DRIVE_ROOT_FOLDER, undefined, DRIVE_FOLDER_MIME);
  if (!root) {
    return {
      rootFolderId: null,
      collections: [],
      singleBooks: [],
      hasProgressFile: false,
    };
  }

  const rootItems = await listDriveFolderItems(token, root.id);
  const hasProgressFile = rootItems.some((f) => f.name === DRIVE_PROGRESS_FILE);
  const subFolders = rootItems.filter((f) => f.mimeType === DRIVE_FOLDER_MIME);

  const collections: DriveCollectionFolderInfo[] = [];
  let singleBooks: DriveItemRef[] = [];

  for (const folder of subFolders) {
    const children = await listDriveFolderItems(token, folder.id);
    const epubFiles = children.filter(
      (f) => f.mimeType !== DRIVE_FOLDER_MIME && f.name.toLowerCase().endsWith('.epub')
    );

    if (folder.name.trim().toLowerCase() === DRIVE_SINGLE_BOOKS_FOLDER.toLowerCase()) {
      singleBooks = epubFiles;
    } else {
      collections.push({
        folderId: folder.id,
        name: folder.name,
        files: epubFiles,
      });
    }
  }

  return {
    rootFolderId: root.id,
    collections,
    singleBooks,
    hasProgressFile,
  };
}

/**
 * Downloads selected collection folders from `sáchlazy` + reading progress manifest,
 * parses every .epub into Book objects, and returns entries ready to merge & auto-create collections.
 */
export async function downloadDriveCollections(
  token: string,
  rootFolderId: string,
  folders: DriveCollectionFolderInfo[],
  onProgress?: (msg: string) => void
): Promise<{ entries: DownloadedBookEntry[]; progressBundle: SyncBackupBundle | null }> {
  const entries: DownloadedBookEntry[] = [];
  const totalFiles = folders.reduce((acc, f) => acc + f.files.length, 0);
  let done = 0;

  for (const folder of folders) {
    for (const file of folder.files) {
      done += 1;
      onProgress?.(
        `Đang tải (${done}/${totalFiles}): ${file.name} (Bộ sưu tập "${folder.name}")...`
      );
      const buf = await downloadDriveFileBuffer(token, file.id);
      const parsed = await parseEpubBuffer(buf, file.name);
      const book: Book = {
        ...parsed,
        id: `book-drive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        collection: folder.name,
        fingerprint: computeBookFingerprint(parsed),
        addedAt: Date.now(),
        lastReadAt: Date.now(),
      };
      entries.push({ book, collectionName: folder.name });
    }
  }

  onProgress?.('Đang đồng bộ tiến độ đọc từ Google Drive...');
  const progressBundle = await downloadProgressManifestFromDrive(token, rootFolderId);

  return { entries, progressBundle };
}

/**
 * Downloads selected single books from `sáchlazy/sách lẻ` + reading progress manifest.
 */
export async function downloadDriveSingleBooks(
  token: string,
  rootFolderId: string,
  files: DriveItemRef[],
  onProgress?: (msg: string) => void
): Promise<{ entries: DownloadedBookEntry[]; progressBundle: SyncBackupBundle | null }> {
  const entries: DownloadedBookEntry[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(`Đang tải sách lẻ (${i + 1}/${files.length}): ${file.name}...`);
    const buf = await downloadDriveFileBuffer(token, file.id);
    const parsed = await parseEpubBuffer(buf, file.name);
    const book: Book = {
      ...parsed,
      id: `book-drive-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fingerprint: computeBookFingerprint(parsed),
      addedAt: Date.now(),
      lastReadAt: Date.now(),
    };
    entries.push({ book });
  }

  onProgress?.('Đang đồng bộ tiến độ đọc từ Google Drive...');
  const progressBundle = await downloadProgressManifestFromDrive(token, rootFolderId);

  return { entries, progressBundle };
}
