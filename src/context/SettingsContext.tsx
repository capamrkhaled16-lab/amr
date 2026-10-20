import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { supabase } from '@/lib/supabase';
import type { Settings } from '@/lib/types';

const DEFAULT_SETTINGS: Settings = {
  id: '',
  platform_name: 'منصة الخالد التعليمية',
  management_name: 'تحت إدارة ومتابعة مستر عمرو خالد',
  teacher_name: 'مستر عمرو خالد',
  logo_url: null,
  teacher_photo_url: null,
  updated_at: '',
  master_pin: '0000',
  default_pin_active: true,
  gemini_api_key: '',
};

type SettingsContextValue = {
  settings: Settings;
  loading: boolean;
  refresh: () => Promise<void>;
  update: (patch: Partial<Settings>) => Promise<void>;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined
);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const query = supabase
        .from('settings')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const timeout = new Promise<{ data: null }>((resolve) => {
        timer = setTimeout(() => resolve({ data: null }), 8000);
      });
      const result = await Promise.race([query, timeout]) as { data: Settings | null };
      if (result.data) setSettings(result.data);
    } catch {
      /* keep defaults on error */
    } finally {
      if (timer) clearTimeout(timer);
      setLoading(false);
    }
  }

  async function update(patch: Partial<Settings>) {
    const current = settings.id
      ? settings
      : ((await supabase
          .from('settings')
          .select('*')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()).data as Settings | null);

    if (current && current.id) {
      const { data } = await supabase
        .from('settings')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', current.id)
        .select()
        .single();
      if (data) setSettings(data);
    } else {
      const { data } = await supabase
        .from('settings')
        .insert({ ...DEFAULT_SETTINGS, ...patch })
        .select()
        .single();
      if (data) setSettings(data);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, loading, refresh, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
