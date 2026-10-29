import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase';
import type { Assistant, AssistantPermissions } from '@/lib/types';
import {
  ASSISTANT_SESSION_KEY,
  DEFAULT_MASTER_PIN,
  MASTER_PIN_KEY,
  SESSION_TIMESTAMP_KEY,
  SESSION_MAX_AGE_MS,
} from '@/lib/constants';

type AuthRole = 'master' | 'assistant' | null;

type AuthSession = {
  role: AuthRole;
  assistant: Assistant | null;
};

type AuthContextValue = {
  role: AuthRole;
  assistant: Assistant | null;
  loading: boolean;
  loginMaster: (pin: string) => Promise<{ ok: boolean; error?: string }>;
  loginAssistant: (
    username: string,
    pin: string
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  can: (perm: keyof AssistantPermissions) => boolean;
  isMaster: boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function withTimeout<T>(
  promise: Promise<{ data: T; error: { message: string } | null }>,
  ms: number,
): Promise<{ data: T; error: { message: string } | null; timedOut: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ data: T; error: null; timedOut: boolean }>((resolve) => {
    timer = setTimeout(() => resolve({ data: null as T, error: null, timedOut: true }), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    if ('timedOut' in result) return result;
    return { ...result, timedOut: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isSessionExpired(): boolean {
  const ts = localStorage.getItem(SESSION_TIMESTAMP_KEY);
  if (!ts) return true;
  const age = Date.now() - parseInt(ts, 10);
  return age > SESSION_MAX_AGE_MS;
}

function stampSession() {
  localStorage.setItem(SESSION_TIMESTAMP_KEY, String(Date.now()));
}

function clearSessionStorage() {
  localStorage.removeItem(ASSISTANT_SESSION_KEY);
  localStorage.removeItem(MASTER_PIN_KEY);
  localStorage.removeItem(SESSION_TIMESTAMP_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession>(() => {
    // Synchronous instant restore from localStorage — no DB query needed to show the UI.
    // The session is validated asynchronously in the background via restoreSession().
    if (isSessionExpired()) {
      clearSessionStorage();
      return { role: null, assistant: null };
    }
    const savedAssistant = localStorage.getItem(ASSISTANT_SESSION_KEY);
    if (savedAssistant) {
      try {
        const parsed = JSON.parse(savedAssistant) as Assistant;
        return { role: 'assistant', assistant: parsed };
      } catch { /* ignore */ }
    }
    const savedPin = localStorage.getItem(MASTER_PIN_KEY);
    if (savedPin) {
      return { role: 'master', assistant: null };
    }
    return { role: null, assistant: null };
  });
  const [loading, setLoading] = useState(false);
  const roleRef = useRef<AuthRole>(null);
  const loginInFlight = useRef(false);
  const restoreStarted = useRef(false);

  useEffect(() => {
    roleRef.current = session.role;
  }, [session.role]);

  useEffect(() => {
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    // Background session validation — does NOT block the UI.
    // The session was already restored synchronously in useState above.
    void restoreSession();
  }, []);

  // Cross-tab auth sync: if another tab logs in as a different role or logs out,
  // reflect that here. This enforces strict role isolation across tabs.
  // Skip on the exam portal route — students there don't have teacher sessions,
  // and cross-tab logout messages from a teacher tab must not disrupt an active exam.
  useEffect(() => {
    const channel = new BroadcastChannel('alkhaled_auth_sync');
    channel.onmessage = (ev) => {
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/exam-portal')) return;
      if (ev.data?.type === 'logout') {
        setSession({ role: null, assistant: null });
      } else if (ev.data?.type === 'login' && ev.data.role !== roleRef.current) {
        setSession({ role: null, assistant: null });
      }
    };
    return () => channel.close();
  }, []);

  // Periodically check session expiry (every 60 seconds)
  // Skip on the exam portal route — students there don't have teacher sessions,
  // and this check causes unnecessary state churn that can interfere with active exams.
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/exam-portal')) return;
      if (roleRef.current && isSessionExpired()) {
        clearSessionStorage();
        setSession({ role: null, assistant: null });
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Refresh session timestamp on user activity to extend the inactivity window.
  // Throttled to at most once per 30 seconds to avoid excessive localStorage writes.
  useEffect(() => {
    let lastStamp = 0;
    const refresh = () => {
      const now = Date.now();
      if (roleRef.current && !isSessionExpired() && now - lastStamp > 30_000) {
        lastStamp = now;
        stampSession();
      }
    };
    window.addEventListener('click', refresh);
    window.addEventListener('keydown', refresh);
    return () => {
      window.removeEventListener('click', refresh);
      window.removeEventListener('keydown', refresh);
    };
  }, []);

  // Check session expiry when the tab becomes visible again (covers switching tabs / minimizing)
  // Skip on the exam portal route — anti-cheat tab-switch detection triggers visibilitychange,
  // and a session-expiry check here could clear a teacher's session if they're monitoring on the same device.
  useEffect(() => {
    const handler = () => {
      if (document.hidden) return;
      if (typeof window !== 'undefined' && window.location.pathname.startsWith('/exam-portal')) return;
      if (roleRef.current && isSessionExpired()) {
        clearSessionStorage();
        setSession({ role: null, assistant: null });
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  async function restoreSession() {
    try {
      // Session is already restored synchronously in useState initializer.
      // Here we validate it against the DB in the background and update if stale/invalid.
      if (isSessionExpired()) {
        clearSessionStorage();
        setSession({ role: null, assistant: null });
        return;
      }

      const savedAssistant = localStorage.getItem(ASSISTANT_SESSION_KEY);
      if (savedAssistant) {
        let parsed: Assistant;
        try {
          parsed = JSON.parse(savedAssistant) as Assistant;
        } catch {
          localStorage.removeItem(ASSISTANT_SESSION_KEY);
          return;
        }
        // Background validation — 2.5s timeout. If it fails, keep the cached session.
        const result = await withTimeout(
          supabase
            .from('assistants')
            .select('*')
            .eq('id', parsed.id)
            .eq('is_active', true)
            .maybeSingle(),
          2500,
        );
        if (result.timedOut || result.error) {
          stampSession();
          return;
        }
        if (!result.data) {
          localStorage.removeItem(ASSISTANT_SESSION_KEY);
          localStorage.removeItem(SESSION_TIMESTAMP_KEY);
          setSession({ role: null, assistant: null });
          return;
        }
        // Update with fresh data from DB
        setSession({ role: 'assistant', assistant: result.data });
        stampSession();
        return;
      }

      const savedPin = localStorage.getItem(MASTER_PIN_KEY);
      if (savedPin) {
        stampSession();
        return;
      }
    } catch {
      stampSession();
    }
  }

  async function loginMaster(
    pin: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (loginInFlight.current) {
      return { ok: false, error: 'جارٍ تسجيل الدخول...' };
    }
    loginInFlight.current = true;
    try {
    const result = await withTimeout(
      supabase
        .from('settings')
        .select('master_pin, default_pin_active')
        .maybeSingle(),
      8000,
    );

    if (result.timedOut) {
      return { ok: false, error: 'انتهت مهلة الاتصال. تحقق من الإنترنت وحاول مرة أخرى.' };
    }
    if (result.error) {
      return { ok: false, error: 'حدث خطأ في الاتصال بقاعدة البيانات' };
    }

    const data = result.data;
    const dbPin = data?.master_pin ?? '0000';
    const defaultActive = data?.default_pin_active ?? true;

    if (pin === '0000' && !defaultActive) {
      return { ok: false, error: 'تم تغيير الرقم السري الافتراضي. استخدم الرقم السري الجديد.' };
    }

    if (pin === dbPin) {
      localStorage.setItem(MASTER_PIN_KEY, pin);
      stampSession();
      setSession({ role: 'master', assistant: null });
      try { const ch = new BroadcastChannel('alkhaled_auth_sync'); ch.postMessage({ type: 'login', role: 'master' }); ch.close(); } catch { /* ignore */ }
      return { ok: true };
    }

    const storedPin = localStorage.getItem(MASTER_PIN_KEY) || DEFAULT_MASTER_PIN;
    if (pin === storedPin && !(pin === '0000' && !defaultActive)) {
      localStorage.setItem(MASTER_PIN_KEY, storedPin);
      stampSession();
      setSession({ role: 'master', assistant: null });
      try { const ch = new BroadcastChannel('alkhaled_auth_sync'); ch.postMessage({ type: 'login', role: 'master' }); ch.close(); } catch { /* ignore */ }
      return { ok: true };
    }
    return { ok: false, error: 'الرقم السري غير صحيح' };
    } finally {
      loginInFlight.current = false;
    }
  }

  async function loginAssistant(
    username: string,
    pin: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (loginInFlight.current) {
      return { ok: false, error: 'جارٍ تسجيل الدخول...' };
    }
    loginInFlight.current = true;
    try {
    const trimmedUsername = username.trim();
    const trimmedPin = pin.trim();

    if (!trimmedUsername || !trimmedPin) {
      return { ok: false, error: 'برجاء إدخال اسم المستخدم والرقم السري' };
    }

    const result = await withTimeout(
      supabase
        .from('assistants')
        .select('*')
        .ilike('username', trimmedUsername)
        .eq('pin', trimmedPin)
        .eq('is_active', true)
        .maybeSingle(),
      8000,
    );

    if (result.timedOut) {
      return { ok: false, error: 'انتهت مهلة الاتصال. تحقق من الإنترنت وحاول مرة أخرى.' };
    }
    if (result.error) {
      return { ok: false, error: 'حدث خطأ في الاتصال' };
    }
    if (!result.data) {
      return { ok: false, error: 'اسم المستخدم أو الرقم السري غير صحيح' };
    }

    const data = result.data;

    localStorage.setItem(ASSISTANT_SESSION_KEY, JSON.stringify(data));
    stampSession();
    setSession({ role: 'assistant', assistant: data });
    try {
      const channel = new BroadcastChannel('alkhaled_auth_sync');
      channel.postMessage({ type: 'login', role: 'assistant' });
      channel.close();
    } catch { /* ignore */ }

    setTimeout(() => {
      supabase
        .from('assistants')
        .update({
          logins_count: (data.logins_count ?? 0) + 1,
          last_login_at: new Date().toISOString(),
        })
        .eq('id', data.id)
        .then(() => {}, () => {});
    }, 0);

    return { ok: true };
    } finally {
      loginInFlight.current = false;
    }
  }

  function logout() {
    clearSessionStorage();
    setSession({ role: null, assistant: null });
    try {
      const channel = new BroadcastChannel('alkhaled_auth_sync');
      channel.postMessage({ type: 'logout' });
      channel.close();
    } catch { /* ignore */ }
  }

  function can(perm: keyof AssistantPermissions): boolean {
    if (session.role === 'master') return true;
    if (session.role === 'assistant' && session.assistant) {
      return session.assistant[perm] ?? false;
    }
    return false;
  }

  const isMaster = session.role === 'master';

  return (
    <AuthContext.Provider
      value={{
        role: session.role,
        assistant: session.assistant,
        loading,
        loginMaster,
        loginAssistant,
        logout,
        can,
        isMaster,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
