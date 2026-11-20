import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const GOOGLE_DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
for (const scope of GOOGLE_DRIVE_SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

export interface DriveAuthSnapshot {
  user: User | null;
  accessToken: string | null;
  isConnected: boolean;
}

// Keep access token strictly in memory (never in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUser: User | null = null;

type Listener = (snapshot: DriveAuthSnapshot) => void;
const listeners = new Set<Listener>();

function emitSnapshot() {
  const snap = getDriveAuthSnapshot();
  listeners.forEach((fn) => fn(snap));
}

export function getDriveAuthSnapshot(): DriveAuthSnapshot {
  return {
    user: cachedUser,
    accessToken: cachedAccessToken,
    isConnected: Boolean(cachedUser && cachedAccessToken),
  };
}

export function subscribeDriveAuth(listener: Listener): () => void {
  listeners.add(listener);
  listener(getDriveAuthSnapshot());
  return () => {
    listeners.delete(listener);
  };
}

let authInitialized = false;

export function initDriveAuth(
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) {
  if (authInitialized) {
    const snap = getDriveAuthSnapshot();
    if (snap.user && snap.accessToken) {
      onAuthSuccess?.(snap.user, snap.accessToken);
    } else {
      onAuthFailure?.();
    }
    return () => {};
  }
  authInitialized = true;

  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      cachedUser = user;
      if (cachedAccessToken) {
        emitSnapshot();
        onAuthSuccess?.(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        emitSnapshot();
        onAuthFailure?.();
      }
    } else {
      cachedUser = null;
      cachedAccessToken = null;
      emitSnapshot();
      onAuthFailure?.();
    }
  });
}

export interface UnauthorizedDomainErrorInfo {
  isUnauthorizedDomain: boolean;
  hostname: string;
  message: string;
}

export function extractUnauthorizedDomainError(err: unknown): UnauthorizedDomainErrorInfo {
  const code = (err as { code?: string })?.code || '';
  const rawMsg = err instanceof Error ? err.message : String(err || '');
  const hostname = typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
  const isUnauthorizedDomain =
    code === 'auth/unauthorized-domain' || /unauthorized-domain/i.test(rawMsg);

  return {
    isUnauthorizedDomain,
    hostname,
    message: isUnauthorizedDomain
      ? `Tên miền "${hostname}" chưa được cấp quyền trong Firebase Console (auth/unauthorized-domain). Hãy thêm "${hostname}" vào Authentication → Settings → Authorized domains.`
      : rawMsg,
  };
}

export async function signInWithGoogleDrive(): Promise<{
  user: User;
  accessToken: string;
}> {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không nhận được mã truy cập Google Drive. Vui lòng thử đăng nhập lại.');
    }
    cachedUser = result.user;
    cachedAccessToken = credential.accessToken;
    emitSnapshot();
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error('Trình duyệt đang chặn cửa sổ bật lên (popup). Hãy cho phép popup rồi bấm đăng nhập lại.');
    }
    const domainInfo = extractUnauthorizedDomainError(err);
    if (domainInfo.isUnauthorizedDomain) {
      const wrapped = new Error(domainInfo.message) as Error & { code?: string };
      wrapped.code = 'auth/unauthorized-domain';
      throw wrapped;
    }
    throw err instanceof Error ? err : new Error('Đăng nhập Google Drive thất bại.');
  } finally {
    isSigningIn = false;
  }
}

export function getDriveAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogleDrive(): Promise<void> {
  await auth.signOut();
  cachedUser = null;
  cachedAccessToken = null;
  emitSnapshot();
}
