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

/**
 * Tracks whether the user has linked their Gmail OAuth client (a
 * separate Google Cloud Console client from the primary one — see
 * `lib/oauth.ts` for the rationale). The link is stored server-side
 * (the Gmail refresh token never leaves the server), so the frontend
 * just keeps a presence bit + scope list to drive UI gating.
 */
interface GmailLinkState {
  scopes: string[];
  linkedAt: string | null;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  /**
   * OAuth scopes Google has actually granted on the *primary* client.
   * Derived from the `scope` field in the token-exchange response.
   * Drives feature gating for Calendar — features whose scope isn't
   * here show a "connect" CTA instead of running. Gmail is tracked
   * separately on `gmail` because it lives on a different OAuth client.
   */
  scopes: string[];
  /** Null when the user hasn't linked Gmail. */
  gmail: GmailLinkState | null;
}

interface AuthContextValue extends AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  hasScope: (scope: string) => boolean;
  hasGmailLink: boolean;
  login: (googleAuthCode: string, redirectUri?: string) => Promise<void>;
  /**
   * Exchange an authorization code from the *Gmail* OAuth client for a
   * server-side Gmail link. The user must already be signed in with
   * the primary client; the backend verifies both halves point at the
   * same Google account before persisting.
   */
  linkGmail: (googleAuthCode: string, redirectUri?: string) => Promise<void>;
  /** Drop the user's Gmail link (server-side + local state). */
  unlinkGmail: () => Promise<void>;
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
  gmail: null,
};

function loadAuth(): AuthState {
  if (typeof window === "undefined") return EMPTY_AUTH;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_AUTH;
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    // `scopes` and `gmail` were added after launch; pre-existing
    // localStorage entries won't have them. Coerce to safe defaults so
    // feature gates fall back to the "needs to grant" / "needs to link"
    // state — the user will re-auth or re-link on their next restricted-
    // feature click and the fields will populate.
    return {
      user: parsed.user ?? null,
      accessToken: parsed.accessToken ?? null,
      refreshToken: parsed.refreshToken ?? null,
      expiresAt: parsed.expiresAt ?? null,
      scopes: Array.isArray(parsed.scopes) ? parsed.scopes : [],
      gmail:
        parsed.gmail &&
        typeof parsed.gmail === "object" &&
        Array.isArray((parsed.gmail as GmailLinkState).scopes)
          ? {
              scopes: (parsed.gmail as GmailLinkState).scopes,
              linkedAt: (parsed.gmail as GmailLinkState).linkedAt ?? null,
            }
          : null,
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

  // Bootstrap scope list from the server when we don't have one yet.
  // Covers two cases:
  //   1. Users who signed in before scope tracking shipped — their
  //      localStorage has no `scopes` field, but their Google token
  //      may already cover Gmail / Calendar from the old all-at-once
  //      consent screen.
  //   2. Edge cases where Google's code-exchange response omitted the
  //      `scope` field on a fresh login.
  // Fetches /auth/scopes (server uses tokeninfo to introspect the
  // access token authoritatively), then merges into state. Skipped
  // when scopes is already populated to avoid an extra request on
  // every mount.
  useEffect(() => {
    if (isLoading) return;
    if (!state.accessToken) return;
    if (state.scopes.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/scopes`, {
          headers: { Authorization: `Bearer ${state.accessToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.scopes)) return;
        if (data.scopes.length === 0) return;
        setState((prev) => ({
          ...prev,
          scopes: Array.from(new Set([...prev.scopes, ...data.scopes])),
        }));
      } catch {
        // Best-effort; the user can still re-grant scopes manually.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, state.accessToken, state.scopes.length]);

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
    setState(() => {
      // Trust `data.scopes` directly — the server reconciled tokeninfo
      // (authoritative on what's currently granted) with the stored
      // set. Don't union with the previous frontend state: if the user
      // revoked a scope in their Google Account and signs back in, we
      // need to drop the stale entry, not preserve it.
      const newScopes = Array.isArray(data.scopes) ? data.scopes : [];
      const gmailFromServer: GmailLinkState | null = data.gmail
        ? {
            scopes: Array.isArray(data.gmail.scopes) ? data.gmail.scopes : [],
            linkedAt: data.gmail.linkedAt ?? null,
          }
        : null;
      return {
        user: data.user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        scopes: newScopes,
        gmail: gmailFromServer,
      };
    });
  }, []);

  const linkGmail = useCallback(
    async (googleAuthCode: string, redirectUri?: string) => {
      // We need primary auth to attach the Gmail link to the right
      // user record. `linkGmail` is only ever called from the OAuth
      // callback, by which point `login()` has already run — so the
      // access token from React state is fresh enough.
      const accessToken =
        // The closure captures the previous state, so read from
        // localStorage as a fallback to handle the re-mount case where
        // the callback page rendered before the state hydrated.
        loadAuth().accessToken;
      if (!accessToken) {
        throw new Error("Sign in with Google first, then link Gmail.");
      }
      const res = await fetch(`${API_BASE_URL}/auth/google/gmail`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ code: googleAuthCode, redirectUri }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Linking Gmail failed");
      }
      const data = await res.json();
      setState((prev) => ({
        ...prev,
        gmail: {
          scopes: Array.isArray(data.scopes) ? data.scopes : [],
          linkedAt: data.linkedAt ?? null,
        },
      }));
    },
    [],
  );

  const unlinkGmail = useCallback(async () => {
    const accessToken = loadAuth().accessToken;
    if (!accessToken) {
      // Nothing to do server-side without auth, but clear local state
      // so the UI flips to the unlinked state immediately.
      setState((prev) => ({ ...prev, gmail: null }));
      return;
    }
    await fetch(`${API_BASE_URL}/auth/google/gmail`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {
      // Best-effort: even if the server call fails (network, expired
      // token), we still clear local state so the UI doesn't lie.
    });
    setState((prev) => ({ ...prev, gmail: null }));
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
      hasGmailLink: !!state.gmail,
      login,
      linkGmail,
      unlinkGmail,
      logout,
    }),
    [state, isLoading, hasScope, login, linkGmail, unlinkGmail, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
