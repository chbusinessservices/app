import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken } from '@/src/api';
import { authenticate, isBiometricEnabled, isBiometricSupported } from '@/src/biometric';

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
  locked: boolean;
  unlock: () => Promise<boolean>;
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
  const [locked, setLocked] = useState(false);

  const refresh = useCallback(async () => {
    const t = await getToken();
    if (!t) { setUser(null); setLocked(false); setLoading(false); return; }
    try {
      const me = await api<User>('/auth/me');
      setUser(me);
      // If biometric is enabled and supported, gate the session behind unlock
      const bioOn = await isBiometricEnabled();
      const bioOk = bioOn ? await isBiometricSupported() : false;
      setLocked(bioOn && bioOk);
    } catch {
      await clearToken();
      setUser(null);
      setLocked(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const unlock = useCallback(async () => {
    const ok = await authenticate('Unlock TaxPilot AI');
    if (ok) setLocked(false);
    return ok;
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
    setLocked(false);
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
    <Ctx.Provider value={{ user, loading, locked, unlock, signIn, signUp, signOut, exchangeSessionId, appleSignIn, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
