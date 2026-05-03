"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  /**
   * OAuth scopes Google has actually granted this session. Derived from
   * the `scope` field in the token-exchange response. Drives feature
   * gating for Gmail / Calendar — features whose scope isn't here show
   * a "connect" CTA instead of running.
   */
  scopes: string[];
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  hasScope: (scope: string) => boolean;
  login: (googleAuthCode: string, redirectUri?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "travel-app-auth";

const EMPTY_AUTH: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  scopes: [],
};

function loadAuth(): AuthState {
  if (typeof window === "undefined") return EMPTY_AUTH;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_AUTH;
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    // `scopes` was added after launch; pre-existing localStorage entries
    // won't have it. Coerce to [] so feature gates fall back to the
    // "needs to grant" state — the user will re-auth on their next
    // restricted-feature click and the scope list will populate.
    return {
      user: parsed.user ?? null,
      accessToken: parsed.accessToken ?? null,
      refreshToken: parsed.refreshToken ?? null,
      expiresAt: parsed.expiresAt ?? null,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
    };
  } catch {
    return EMPTY_AUTH;
  }
}

function saveAuth(state: AuthState) {
  if (typeof window === "undefined") return;
  if (state.user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AuthState>(EMPTY_AUTH);
  const [isLoading, setIsLoading] = useState(true);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = loadAuth();
    setState(stored);
    setIsLoading(false);
  }, []);

  // Persist state changes
  useEffect(() => {
    if (!isLoading) {
      saveAuth(state);
    }
  }, [state, isLoading]);

  // Auto-refresh token before expiry
  useEffect(() => {
    if (!state.refreshToken || !state.expiresAt) return;

    const msUntilExpiry = state.expiresAt - Date.now();
    // Refresh 5 minutes before expiry
    const refreshIn = Math.max(msUntilExpiry - 5 * 60 * 1000, 0);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: state.refreshToken }),
        });
        if (!res.ok) throw new Error("Refresh failed");
        const data = await res.json();
        setState((prev) => ({
          ...prev,
          accessToken: data.accessToken,
          expiresAt: data.expiresAt,
        }));
      } catch {
        // If refresh fails, log the user out
        setState(EMPTY_AUTH);
      }
    }, refreshIn);

    return () => clearTimeout(timer);
  }, [state.refreshToken, state.expiresAt]);

  const login = useCallback(async (googleAuthCode: string, redirectUri?: string) => {
    const res = await fetch(`${API_BASE_URL}/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: googleAuthCode, redirectUri }),
    });

    if (!res.ok) {
      const body = await res.json();
      throw new Error(body.error || "Login failed");
    }

    const data = await res.json();
    setState({
      user: data.user,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
    });
  }, []);

  const logout = useCallback(() => {
    setState(EMPTY_AUTH);
  }, []);

  const hasScope = useCallback(
    (scope: string) => state.scopes.includes(scope),
    [state.scopes],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isAuthenticated: !!state.user && !!state.accessToken,
      isLoading,
      hasScope,
      login,
      logout,
    }),
    [state, isLoading, hasScope, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
