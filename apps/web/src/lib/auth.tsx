"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabase";

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

/**
 * Build an AuthState from a Supabase session. The provider-side bits
 * (`scopes`, `gmail`) are intentionally left empty here — they're
 * populated separately:
 *   - `scopes` from the `connections` table after sign-in (Phase 4
 *     connector wiring will hydrate it; for now the legacy `/auth/scopes`
 *     bootstrap effect keeps working for users still on the legacy
 *     access-token path)
 *   - `gmail` from the dedicated `/auth/google/gmail` link flow, which
 *     stays on its own OAuth client for CASA reasons
 *
 * Microsoft accounts: Supabase's OIDC userinfo for Azure AD doesn't
 * include `avatar_url` (Microsoft doesn't surface the profile photo
 * via standard OIDC claims). We patch the photo in asynchronously via
 * `fetchMicrosoftAvatar` below, reading from
 * `https://graph.microsoft.com/v1.0/me/photo/$value` with the
 * provider_token and caching the resulting data URL to localStorage
 * so subsequent loads render the photo instantly without another
 * Graph round-trip.
 */
const MS_AVATAR_CACHE_PREFIX = "ms-avatar:";

function getCachedMicrosoftAvatar(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${MS_AVATAR_CACHE_PREFIX}${userId}`);
  } catch {
    return null;
  }
}

function setCachedMicrosoftAvatar(userId: string, dataUrl: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${MS_AVATAR_CACHE_PREFIX}${userId}`, dataUrl);
  } catch {
    // localStorage full / disabled — non-fatal, we'll just re-fetch next
    // session.
  }
}

/**
 * Fetches the signed-in Microsoft user's profile photo via Microsoft
 * Graph and returns it as a data URL. Uses the provider_token surfaced
 * by Supabase on the OAuth callback (`session.provider_token`), which
 * is the underlying Microsoft access token with `User.Read` delegated
 * permission — automatically granted by the `openid profile` scopes the
 * login page requests.
 *
 * Returns null when:
 * - The user has no photo set (`/me/photo/$value` returns 404)
 * - The provider_token expired (1h lifetime; after the first Supabase
 *   session refresh it's no longer exposed)
 * - The Graph request fails for any other reason (network, CORS, etc.)
 *
 * All failure modes are non-fatal — the auth state just keeps its
 * undefined `picture` and the user-menu's fallback icon renders.
 */
async function fetchMicrosoftAvatar(providerToken: string): Promise<string | null> {
  try {
    const res = await fetch(
      "https://graph.microsoft.com/v1.0/me/photo/$value",
      { headers: { Authorization: `Bearer ${providerToken}` } },
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function authStateFromSupabaseSession(session: Session): AuthState {
  const user = session.user;
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : (user.email ?? "");
  // Prefer whatever Supabase surfaced from the provider (Google: yes;
  // Microsoft: no). If neither is present and we have a cached Graph
  // photo for this user, use that. Asynchronous Graph fetches that
  // come after sign-in patch this in via setState — the cache is what
  // makes a returning user's photo show up before the Graph round-trip
  // completes (or at all, when the provider_token has already
  // expired).
  const providerPicture =
    typeof metadata.avatar_url === "string"
      ? metadata.avatar_url
      : typeof metadata.picture === "string"
        ? metadata.picture
        : undefined;
  const picture = providerPicture ?? getCachedMicrosoftAvatar(user.id) ?? undefined;
  return {
    user: {
      id: user.id,
      email: user.email ?? "",
      name,
      picture,
    },
    // The API client sends this as `Authorization: Bearer ...`. The
    // server's `requireAuth` middleware (Phase 3 commit 3) recognises
    // Supabase JWTs by shape and validates them via the project's
    // JWKS — so the same `accessToken` field on AuthState backs both
    // sign-in paths during the coexistence window.
    accessToken: session.access_token,
    // Supabase handles refresh internally via its own
    // `autoRefreshToken: true`; we don't need a frontend timer.
    // Storing the refresh token would be redundant.
    refreshToken: null,
    expiresAt: session.expires_at ? session.expires_at * 1000 : null,
    scopes: [],
    gmail: null,
  };
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

  // Phase 3b: subscribe to Supabase auth state changes. When a session
  // is present, it takes precedence over the legacy localStorage
  // AuthState — the API client picks up the Supabase JWT via
  // `state.accessToken` and the server-side `requireAuth` middleware
  // routes JWT-shaped tokens through the Supabase validator
  // (phase 3 commit 3). When no Supabase session exists, we keep the
  // legacy AuthState intact so existing users continue working
  // through the cutover.
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelled = false;

    // Fire-and-forget Graph fetch for Microsoft users. The first time a
    // Microsoft user signs in, Supabase exposes the underlying Azure
    // access token as `session.provider_token` — short-lived (~1h) and
    // only available immediately post-sign-in. We use it to GET the
    // user's profile photo from `/me/photo/$value` and cache the
    // resulting data URL to localStorage. On future page loads, the
    // cached value flows through `authStateFromSupabaseSession` and
    // the photo renders without any Graph round-trip.
    //
    // Skips itself when:
    // - The user already has an avatar URL from the provider (Google).
    // - The user already has a cached Graph photo (returning user on
    //   the same device).
    // - `provider_token` isn't present (session was refreshed, the
    //   provider token was discarded and we never cached the photo —
    //   user-menu just shows the fallback icon until they sign in
    //   again, which is rare enough not to be worth a re-fetch flow).
    const maybeFetchMicrosoftAvatar = (session: Session): void => {
      if (cancelled) return;
      const provider = session.user.app_metadata?.provider;
      if (provider !== "azure") return;
      if (getCachedMicrosoftAvatar(session.user.id)) return;
      const metadata = session.user.user_metadata ?? {};
      if (
        typeof (metadata as Record<string, unknown>).avatar_url === "string" ||
        typeof (metadata as Record<string, unknown>).picture === "string"
      ) {
        return;
      }
      const providerToken = session.provider_token;
      if (!providerToken) return;
      void fetchMicrosoftAvatar(providerToken).then((dataUrl) => {
        if (cancelled || !dataUrl) return;
        setCachedMicrosoftAvatar(session.user.id, dataUrl);
        setState((prev) =>
          prev.user
            ? { ...prev, user: { ...prev.user, picture: dataUrl } }
            : prev,
        );
      });
    };

    // Pull the existing session on mount so a page reload keeps the
    // Supabase auth path active without waiting for a state change.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return;
      setState(authStateFromSupabaseSession(data.session));
      maybeFetchMicrosoftAvatar(data.session);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (cancelled) return;
        if (session) {
          setState(authStateFromSupabaseSession(session));
          maybeFetchMicrosoftAvatar(session);
        } else if (event === "SIGNED_OUT") {
          // Supabase sign-out should also clear legacy auth state so
          // the user lands in a clean "signed out" UI. The dual-path
          // user menu only triggers one of the two sign-outs at a
          // time; this branch covers the Supabase side.
          setState(EMPTY_AUTH);
        }
      },
    );

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
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
    // Phase 3b: also sign out of Supabase if the user came in through
    // that path. No-op when Supabase isn't configured or there's no
    // active Supabase session.
    const supabase = getSupabaseClient();
    if (supabase) {
      void supabase.auth.signOut().catch(() => {
        // Best-effort — local state is already cleared above, the
        // worst case is a stale Supabase session sitting in
        // localStorage until the next visit.
      });
    }
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
