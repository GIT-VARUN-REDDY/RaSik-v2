import * as SecureStore from 'expo-secure-store';

let currentBaseUrl = (process.env.EXPO_PUBLIC_API_URL || 'https://rasik-v2.onrender.com').replace(/\/$/, '');

export const getApiUrl = () => currentBaseUrl;
export const getWsUrl = () => currentBaseUrl.replace(/^http/, 'ws') + '/ws';
export { currentBaseUrl as API_URL };
export const WS_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://rasik-v2.onrender.com').replace(/\/$/, '').replace(/^http/, 'ws') + '/ws';


export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

let tokens: { accessToken: string; refreshToken: string } | null = null;
let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (fn: () => void) => { onSignedOut = fn; };
export const getAccessToken = () => tokens?.accessToken ?? null;

export async function loadTokens() {
  try {
    const raw = await SecureStore.getItemAsync('tokens');
    tokens = raw ? JSON.parse(raw) : null;
  } catch { tokens = null; }
  return tokens;
}

export async function saveTokens(t: { accessToken: string; refreshToken: string } | null) {
  tokens = t;
  try {
    if (t) await SecureStore.setItemAsync('tokens', JSON.stringify({ accessToken: t.accessToken, refreshToken: t.refreshToken }));
    else await SecureStore.deleteItemAsync('tokens');
  } catch {}
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!tokens) return false;
  refreshing ??= (async () => {
    try {
      const r = await fetch(`${currentBaseUrl}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: tokens!.refreshToken }) });
      if (!r.ok) { await saveTokens(null); onSignedOut(); return false; }
      await saveTokens(await r.json());
      return true;
    } catch { return false; }
    finally { setTimeout(() => { refreshing = null; }, 0); }
  })();
  return refreshing;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 6000, isForm = false): Promise<Response> {
  if (isForm) {
    // Avoid AbortSignal on React Native Android streaming FormData to prevent premature aborts
    return await fetch(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(method: string, path: string, body?: unknown, form?: FormData, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (tokens) headers.authorization = `Bearer ${tokens.accessToken}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const fetchInit: RequestInit = {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  };

  const timeoutMs = form ? 60000 : 10000;
  let res: Response;
  try {
    res = await fetchWithTimeout(currentBaseUrl + path, fetchInit, timeoutMs, !!form);
  } catch (err: unknown) {
    console.warn('[Network Error on primary]', currentBaseUrl + path, err);
    // Try backup endpoint (Render <-> local ADB reverse)
    const backupUrl = currentBaseUrl.includes('onrender.com') ? 'http://127.0.0.1:8001' : 'https://rasik-v2.onrender.com';
    try {
      res = await fetchWithTimeout(backupUrl + path, fetchInit, timeoutMs, !!form);
      currentBaseUrl = backupUrl; // Pin the working endpoint
    } catch (backupErr: unknown) {
      console.warn('[Network Error on backup]', backupUrl + path, backupErr);
      const detail = err instanceof Error ? err.message : String(err);
      throw new ApiError(0, `Connection error (${detail}). Check your internet connection.`, 'network');
    }
  }

  if (res.status === 401 && retry && tokens && (await refresh())) return request<T>(method, path, body, form, false);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong.', data.code);
  return data as T;
}

function uploadFile<T>(path: string, uri: string, name: string, type: string): Promise<T> {
  const url = currentBaseUrl + path;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    if (tokens?.accessToken) {
      xhr.setRequestHeader('authorization', `Bearer ${tokens.accessToken}`);
    }
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data as T);
        } else {
          reject(new ApiError(xhr.status, data.error || 'Upload failed', data.code));
        }
      } catch {
        reject(new ApiError(xhr.status, 'Invalid response from server'));
      }
    };
    xhr.onerror = (e) => {
      console.warn('[XHR Upload Error]', url, e);
      const backupUrl = currentBaseUrl.includes('onrender.com') ? 'http://127.0.0.1:8001' : 'https://rasik-v2.onrender.com';
      const xhrBackup = new XMLHttpRequest();
      xhrBackup.open('POST', backupUrl + path);
      if (tokens?.accessToken) {
        xhrBackup.setRequestHeader('authorization', `Bearer ${tokens.accessToken}`);
      }
      xhrBackup.onload = () => {
        try {
          const data = JSON.parse(xhrBackup.responseText || '{}');
          if (xhrBackup.status >= 200 && xhrBackup.status < 300) {
            currentBaseUrl = backupUrl;
            resolve(data as T);
          } else {
            reject(new ApiError(xhrBackup.status, data.error || 'Upload failed', data.code));
          }
        } catch {
          reject(new ApiError(xhrBackup.status, 'Invalid response from server'));
        }
      };
      xhrBackup.onerror = () => {
        reject(new ApiError(0, 'Upload network error. Check your connection.', 'network'));
      };
      const fBackup = new FormData();
      fBackup.append('file', { uri, name, type } as any);
      xhrBackup.send(fBackup);
    };
    const f = new FormData();
    f.append('file', { uri, name, type } as any);
    xhr.send(f);
  });
}

export const api = {
  get: <T,>(p: string) => request<T>('GET', p),
  post: <T,>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T,>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T,>(p: string) => request<T>('DELETE', p),
  upload: <T,>(p: string, uri: string, name: string, type: string) => uploadFile<T>(p, uri, name, type),
};


// ---- shared types
export type ListenerSelf = {
  approval: 'none' | 'pending' | 'approved' | 'rejected'; rejectReason: string | null; style: 'girlfriend' | 'friend' | 'listener';
  voiceRate: number; videoRate: number; isAvailable: boolean; hasVideo: boolean; hasVoice: boolean; upiId: string | null;
  balancePaise: number; lifetimePaise: number; totalMinutes: number; totalCalls: number;
  tier: { name: string; maxVoice: number; maxVideo: number };
};
export type Me = {
  id: string; phone: string; role: 'user' | 'admin'; gender: 'male' | 'female' | null; name: string | null; age: number | null;
  avatar: string | null; bio: string; interests: string[]; languages: string[]; onboarded: boolean; coins: number; listener: ListenerSelf | null;
};
export type ListenerCardT = {
  id: string; name: string; age: number; avatar: string | null; bio: string; interests: string[]; languages: string[];
  style: 'girlfriend' | 'friend' | 'listener'; voiceRate: number; videoRate: number; rating: number | null; ratingCount: number;
  totalCalls: number; voiceIntro: string | null; state: 'online' | 'busy' | 'offline'; isFavorite: boolean;
};
