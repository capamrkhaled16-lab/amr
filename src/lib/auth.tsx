import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { useToast } from "./toast";
import type { Assistant } from "./types";

interface AuthContextValue {
  assistant: Assistant | null;
  loading: boolean;
  login: (username: string, pin: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "alkhaled_auth_assistant_id";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [assistant, setAssistant] = useState<Assistant | null>(null);
  const [loading, setLoading] = useState(true);
  const { showError } = useToast();

  useEffect(() => {
    const storedId = localStorage.getItem(STORAGE_KEY);
    if (!storedId) {
      setLoading(false);
      return;
    }
    supabase
      .from("assistants")
      .select("*")
      .eq("id", storedId)
      .eq("is_active", true)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          localStorage.removeItem(STORAGE_KEY);
        }
        setAssistant(data as Assistant | null);
        setLoading(false);
      });
  }, []);

  const login = async (username: string, pin: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from("assistants")
      .select("*")
      .eq("username", username.trim())
      .eq("pin", pin.trim())
      .eq("is_active", true)
      .single();

    if (error || !data) {
      showError("بيانات الدخول غير صحيحة");
      return false;
    }

    const assistantData = data as Assistant;
    localStorage.setItem(STORAGE_KEY, assistantData.id);
    setAssistant(assistantData);

    supabase
      .from("assistants")
      .update({
        logins_count: assistantData.logins_count + 1,
        last_login_at: new Date().toISOString(),
      })
      .eq("id", assistantData.id)
      .then(() => {});

    return true;
  };

  const logout = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAssistant(null);
  };

  return (
    <AuthContext.Provider value={{ assistant, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
