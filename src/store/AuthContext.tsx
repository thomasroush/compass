import {
  createContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';

export type AuthStatus = 'loading' | 'ready';

export interface AuthResult {
  ok: boolean;
  message: string;
}

interface AuthContextValue {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  isPasswordRecovery: boolean;
  isSupabaseConfigured: boolean;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  cancelPasswordRecovery: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const UNCONFIGURED_MESSAGE =
  'Cloud account access is unavailable because this app is not connected to Supabase.';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isSupabaseConfigured ? 'loading' : 'ready');
  const [session, setSession] = useState<Session | null>(null);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setStatus('ready');
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus('ready');
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setStatus('ready');
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true);
      }
      if (event === 'SIGNED_OUT') {
        setIsPasswordRecovery(false);
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: UNCONFIGURED_MESSAGE };
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) return { ok: false, message: error.message };
    if (data.session) return { ok: true, message: 'Account created. You are signed in.' };
    return {
      ok: true,
      message: 'Account created. Check your email to confirm your address before signing in.',
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: UNCONFIGURED_MESSAGE };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: 'Signed in.' };
  }, []);

  const signOut = useCallback(async (): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: UNCONFIGURED_MESSAGE };
    const { error } = await supabase.auth.signOut();
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: 'Signed out.' };
  }, []);

  const requestPasswordReset = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: UNCONFIGURED_MESSAGE };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) return { ok: false, message: error.message };
    return {
      ok: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    };
  }, []);

  const updatePassword = useCallback(async (newPassword: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: UNCONFIGURED_MESSAGE };
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, message: error.message };
    return { ok: true, message: 'Password updated.' };
  }, []);

  const cancelPasswordRecovery = useCallback(() => {
    setIsPasswordRecovery(false);
  }, []);

  const value: AuthContextValue = {
    status,
    session,
    user: session?.user ?? null,
    isPasswordRecovery,
    isSupabaseConfigured,
    signUp,
    signIn,
    signOut,
    requestPasswordReset,
    updatePassword,
    cancelPasswordRecovery,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
