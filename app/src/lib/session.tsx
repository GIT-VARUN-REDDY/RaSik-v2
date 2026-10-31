import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, loadTokens, saveTokens, setSignedOutHandler, Me } from './api';

type Ctx = {
  ready: boolean; me: Me | null;
  signIn: (t: { accessToken: string; refreshToken: string }, user: Me) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<Me | null>;
  patch: (m: Me) => void;
  setCoins: (n: number) => void;
};
const S = createContext<Ctx>(null as never);
export const useSession = () => useContext(S);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const signOut = useCallback(async () => {
    try { const t = await loadTokens(); if (t) await api.post('/auth/logout', { refreshToken: t.refreshToken }); } catch {}
    await saveTokens(null); setMe(null);
  }, []);

  useEffect(() => {
    setSignedOutHandler(() => setMe(null));
    (async () => {
      const t = await loadTokens();
      if (t) { try { setMe(await api.get<Me>('/me')); } catch {} }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(async (t: { accessToken: string; refreshToken: string }, user: Me) => {
    await saveTokens(t);
    setMe(user);
  }, []);

  const reload = useCallback(async () => {
    try {
      const m = await api.get<Me>('/me');
      setMe(m);
      return m;
    } catch {
      return null;
    }
  }, []);

  const patch = useCallback((m: Me) => {
    setMe(m);
  }, []);

  const setCoins = useCallback((n: number) => {
    setMe((m) => (m ? { ...m, coins: n } : m));
  }, []);

  const value = useMemo<Ctx>(() => ({
    ready, me,
    signIn,
    signOut,
    reload,
    patch,
    setCoins,
  }), [ready, me, signIn, signOut, reload, patch, setCoins]);
  return <S.Provider value={value}>{children}</S.Provider>;
}
