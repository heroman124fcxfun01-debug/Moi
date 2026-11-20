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

export interface DriveAuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface DriveAuthSnapshot {
  user: DriveAuthUser | null;
  accessToken: string | null;
  isConnected: boolean;
}

// Keep access token strictly in memory (never in localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUser: DriveAuthUser | null = null;
let isDirectOAuthSession = false;

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
  onAuthSuccess?: (user: DriveAuthUser, token: string) => void,
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
    // Do not wipe an active Direct Google OAuth / GIS session when Firebase auth state is null
    if (isDirectOAuthSession && cachedUser && cachedAccessToken) {
      emitSnapshot();
      onAuthSuccess?.(cachedUser, cachedAccessToken);
      return;
    }
    if (user) {
      cachedUser = {
        uid: user.uid,
        displayName: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
      };
      if (cachedAccessToken) {
        emitSnapshot();
        onAuthSuccess?.(cachedUser, cachedAccessToken);
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
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname || 'localhost' : 'localhost';
  const isUnauthorizedDomain =
    code === 'auth/unauthorized-domain' || /unauthorized-domain/i.test(rawMsg);

  return {
    isUnauthorizedDomain,
    hostname,
    message: isUnauthorizedDomain
      ? `Tên miền "${hostname}" chưa được cấp quyền trong Firebase Console (auth/unauthorized-domain). Bạn có thể dùng "Đăng nhập Google OAuth trực tiếp" hoặc thêm "${hostname}" vào Firebase Console → Authentication → Settings → Authorized domains.`
      : rawMsg,
  };
}

interface GoogleGisTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleGisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleGisNamespace {
  accounts?: {
    oauth2?: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (resp: GoogleGisTokenResponse) => void;
        error_callback?: (err: { type?: string; message?: string }) => void;
      }) => GoogleGisTokenClient;
    };
  };
}

let gisLoadPromise: Promise<void> | null = null;

function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google OAuth chỉ hỗ trợ trong trình duyệt.'));
  }
  const existing = (window as unknown as { google?: GoogleGisNamespace }).google;
  if (existing?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('Không thể tải Google Identity Services. Vui lòng kiểm tra kết nối mạng.'));
    };
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

async function fetchGoogleUserProfile(accessToken: string): Promise<DriveAuthUser> {
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.ok) {
      const data = (await resp.json()) as {
        sub?: string;
        name?: string;
        email?: string;
        picture?: string;
      };
      return {
        uid: data.sub || `oauth-${Date.now()}`,
        displayName: data.name || data.email || 'Người dùng Google Drive',
        email: data.email || null,
        photoURL: data.picture || null,
      };
    }
  } catch {
    // Fall back to Drive About endpoint below
  }

  // Fallback: verify token via Google Drive /about endpoint (works with drive.file scope alone)
  const aboutResp = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!aboutResp.ok) {
    throw new Error('Mã truy cập Google Drive không hợp lệ hoặc đã hết hạn.');
  }
  const aboutData = (await aboutResp.json()) as {
    user?: { displayName?: string; emailAddress?: string; photoLink?: string };
  };
  return {
    uid: `drive-${aboutData.user?.emailAddress || Date.now()}`,
    displayName: aboutData.user?.displayName || 'Người dùng Google Drive',
    email: aboutData.user?.emailAddress || null,
    photoURL: aboutData.user?.photoLink || null,
  };
}

/**
 * Direct Google Identity Services (GIS) OAuth2 login — bypasses Firebase Authorized Domain checks
 * so `localhost` and Capacitor WebView origins can authorize Google Drive directly using oAuthClientId.
 */
export async function signInWithGoogleDriveDirectOAuth(): Promise<{
  user: DriveAuthUser;
  accessToken: string;
}> {
  const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId || '';
  if (!clientId) {
    throw new Error('Chưa cấu hình Google OAuth Client ID cho ứng dụng.');
  }

  await loadGoogleIdentityScript();
  const googleNs = (window as unknown as { google?: GoogleGisNamespace }).google;
  const initTokenClient = googleNs?.accounts?.oauth2?.initTokenClient;
  if (!initTokenClient) {
    throw new Error('Google Identity Services chưa sẵn sàng trên trình duyệt này.');
  }

  const accessToken = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const client = initTokenClient({
      client_id: clientId,
      scope: `${GOOGLE_DRIVE_SCOPES.join(' ')} openid email profile`,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          finish(() =>
            reject(
              new Error(
                resp.error_description ||
                  resp.error ||
                  'Không nhận được mã truy cập từ Google OAuth.'
              )
            )
          );
          return;
        }
        finish(() => resolve(resp.access_token!));
      },
      error_callback: (err) => {
        if (err?.type === 'popup_closed') {
          finish(() =>
            reject(new Error('Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.'))
          );
          return;
        }
        finish(() =>
          reject(new Error(err?.message || 'Cửa sổ đăng nhập Google OAuth bị chặn hoặc lỗi.'))
        );
      },
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });

  const user = await fetchGoogleUserProfile(accessToken);
  isDirectOAuthSession = true;
  cachedUser = user;
  cachedAccessToken = accessToken;
  emitSnapshot();
  return { user, accessToken };
}

/**
 * Connects Google Drive using a user-supplied OAuth2 Access Token (fallback for APK / localhost
 * when both Firebase and popup OAuth are restricted by WebView/domain policies).
 */
export async function connectGoogleDriveWithToken(rawToken: string): Promise<{
  user: DriveAuthUser;
  accessToken: string;
}> {
  const token = rawToken.trim().replace(/^Bearer\s+/i, '');
  if (!token || token.length < 20) {
    throw new Error('Vui lòng dán mã truy cập (OAuth Access Token) hợp lệ.');
  }
  const user = await fetchGoogleUserProfile(token);
  isDirectOAuthSession = true;
  cachedUser = user;
  cachedAccessToken = token;
  emitSnapshot();
  return { user, accessToken: token };
}

function isLocalhostOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const host = (window.location.hostname || '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}

export async function signInWithGoogleDrive(): Promise<{
  user: DriveAuthUser;
  accessToken: string;
}> {
  try {
    isSigningIn = true;

    // On localhost / Capacitor APK, try Direct Google OAuth (GIS) first if oAuthClientId exists,
    // avoiding Firebase's auth/unauthorized-domain blocker seamlessly.
    if (isLocalhostOrigin() && (firebaseConfig as { oAuthClientId?: string }).oAuthClientId) {
      try {
        return await signInWithGoogleDriveDirectOAuth();
      } catch (gisErr) {
        // If user explicitly closed the popup, surface immediately without retrying Firebase
        const msg = gisErr instanceof Error ? gisErr.message : '';
        if (/đóng cửa sổ/i.test(msg)) {
          throw gisErr;
        }
        // Otherwise fall through to Firebase popup attempt
      }
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Không nhận được mã truy cập Google Drive. Vui lòng thử đăng nhập lại.');
    }
    isDirectOAuthSession = false;
    cachedUser = {
      uid: result.user.uid,
      displayName: result.user.displayName,
      email: result.user.email,
      photoURL: result.user.photoURL,
    };
    cachedAccessToken = credential.accessToken;
    emitSnapshot();
    return { user: cachedUser, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
      throw new Error('Bạn đã đóng cửa sổ đăng nhập Google trước khi hoàn tất.');
    }
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'Trình duyệt đang chặn cửa sổ bật lên (popup). Hãy cho phép popup rồi bấm đăng nhập lại.'
      );
    }
    const domainInfo = extractUnauthorizedDomainError(err);
    if (domainInfo.isUnauthorizedDomain) {
      // Auto-fallback to Direct GIS OAuth before showing unauthorized-domain error
      if (!isLocalhostOrigin() && (firebaseConfig as { oAuthClientId?: string }).oAuthClientId) {
        try {
          return await signInWithGoogleDriveDirectOAuth();
        } catch {
          // Fall through to structured unauthorized-domain guidance + direct token fallback
        }
      }
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
  isDirectOAuthSession = false;
  try {
    await auth.signOut();
  } catch {
    // ignore if direct OAuth session only
  }
  cachedUser = null;
  cachedAccessToken = null;
  emitSnapshot();
}
