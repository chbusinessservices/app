import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from '@/src/api';

export type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
  role?: string;
};

type AuthCtx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  exchangeSessionId: (sessionId: string) => Promise<void>;
  appleSignIn: (identity_token: string, email?: string, full_name?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const t = await getToken();
    if (!t) { setUser(null); setLoading(false); return; }
    try {
      const me = await api<User>('/auth/me');
      setUser(me);
    } catch {
      await clearToken();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const r = await api<{ session_token: string; user: User }>('/auth/login', {
      method: 'POST', auth: false, body: JSON.stringify({ email, password }),
    });
    await setToken(r.session_token);
    setUser(r.user);
  }, []);

  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    const r = await api<{ session_token: string; user: User }>('/auth/signup', {
      method: 'POST', auth: false, body: JSON.stringify({ email, password, name }),
    });
    await setToken(r.session_token);
    setUser(r.user);
  }, []);

  const signOut = useCallback(async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    await clearToken();
    setUser(null);
  }, []);

  const exchangeSessionId = useCallback(async (sessionId: string) => {
    const r = await api<{ session_token: string; user: User }>('/auth/session', {
      method: 'POST', auth: false, body: JSON.stringify({ session_id: sessionId }),
    });
    await setToken(r.session_token);
    setUser(r.user);
  }, []);

  const appleSignIn = useCallback(async (identity_token: string, email?: string, full_name?: string) => {
    const r = await api<{ session_token: string; user: User }>('/auth/apple', {
      method: 'POST', auth: false, body: JSON.stringify({ identity_token, email, full_name }),
    });
    await setToken(r.session_token);
    setUser(r.user);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, signIn, signUp, signOut, exchangeSessionId, appleSignIn, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
