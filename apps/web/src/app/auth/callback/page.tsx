"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { useAuth } from "@/lib/auth";
import {
  consumeOAuthState,
  decodeState,
  getOAuthRedirectUri,
  isAllowlistedRelayOrigin,
} from "@/lib/oauth";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

type ConnectionCapability = "identity" | "email" | "calendar";

interface PendingConnection {
  capability: "email" | "calendar";
  /** Where to land the user after the callback. */
  returnTo?: string;
  /**
   * The scopes the Connect flow requested at OAuth time. Stored on
   * the resulting `connections` row so the server's refresh helper
   * can pass them back to the provider on token refresh —
   * Microsoft v2 rejects refresh-with-empty-resource-scopes as
   * invalid_scope. Optional for backwards compat with older
   * Connect flows that didn't record scopes.
   */
  scopes?: string[];
}

const PENDING_CONNECTION_KEY = "pending-connection";

/**
 * Sets a sessionStorage flag that the auth callback reads after the
 * Supabase OAuth round-trip completes. The callback writes a
 * `/api/v1/connections` row with the right `capability` based on
 * the flag, so a single OAuth flow doubles as "sign in" + "grant
 * email/calendar capability" — provider scope set is what determines
 * what the resulting access token can do; the connection row just
 * records that we have it.
 *
 * Exported so the settings page can mark a pending capability link
 * right before calling `supabase.auth.signInWithOAuth(...)`.
 */
export function markPendingConnection(pending: PendingConnection): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(PENDING_CONNECTION_KEY, JSON.stringify(pending));
  } catch {
    // Storage disabled — the callback will just write an identity row
    // and the capability will be missing. The settings page detects
    // this on its next render and re-offers the Connect button.
  }
}

function consumePendingConnection(): PendingConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_CONNECTION_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_CONNECTION_KEY);
    const parsed = JSON.parse(raw) as PendingConnection;
    if (parsed.capability !== "email" && parsed.capability !== "calendar") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function postConnection(
  session: Session,
  capability: ConnectionCapability,
  normalisedProvider: "google" | "microsoft",
  email: string,
  scopes?: string[],
): Promise<{ ok: boolean; message?: string }> {
  const body: Record<string, unknown> = {
    provider: normalisedProvider,
    capability,
    accountEmail: email,
    // provider_token = the underlying Google/Microsoft access token.
    // Only present immediately post-sign-in; Supabase doesn't store
    // it persistently after the next session refresh (unless the
    // provider returned a refresh token too). That's fine for
    // identity — we capture what we have and the server treats
    // missing tokens as "no capability beyond identity yet".
    accessToken: session.provider_token ?? undefined,
    refreshToken: session.provider_refresh_token ?? undefined,
  };
  // Record the scopes the OAuth flow requested. The server's
  // Microsoft refresh helper passes these back to the v2 token
  // endpoint — without them, Microsoft rejects refresh with
  // `invalid_scope` for connections that only have identity scopes
  // stored. Omitted for the identity capability and any flow that
  // doesn't pass them explicitly.
  if (scopes && scopes.length > 0) {
    body.scopes = scopes;
  }
  try {
    const res = await fetch(`${API_BASE_URL}/connections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Try to lift the server's error message off the body so the
      // user sees something specific. Falls back to the status code
      // when the response isn't JSON or doesn't have an `error`.
      let message = `Request failed (${res.status})`;
      try {
        const parsed = (await res.json()) as { error?: string };
        if (parsed.error) message = parsed.error;
      } catch {
        // Non-JSON response; keep the fallback message.
      }
      return { ok: false, message };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Network error while saving the connection.",
    };
  }
}

/**
 * Best-effort POST of the user's connection rows to the server.
 * Always writes an `identity` row (so the server knows the user
 * has signed in via this provider). Additionally writes an
 * `email` or `calendar` row when a pending-capability flag was set
 * before sign-in (see `markPendingConnection`).
 *
 * Returns a `returnTo` URL when one was carried on the pending flag
 * — the settings-page Connect buttons stash their own URL there so
 * the user lands back where they came from after the OAuth dance.
 */
async function syncConnections(
  session: Session,
): Promise<{ returnTo: string | null; capabilityError: string | null }> {
  const provider = session.user.app_metadata?.provider;
  // Supabase reports Microsoft as "azure"; normalise to our taxonomy.
  const normalisedProvider =
    provider === "azure"
      ? "microsoft"
      : provider === "google"
        ? "google"
        : null;
  if (!normalisedProvider) {
    return { returnTo: null, capabilityError: null };
  }
  const email = session.user.email;
  if (!email) return { returnTo: null, capabilityError: null };

  // Identity-row failures are silent: the user is still authenticated
  // via the Supabase JWT, the missing row is recoverable on the next
  // sign-in or settings visit, and there's no actionable UX response
  // we could offer here.
  await postConnection(session, "identity", normalisedProvider, email);

  const pending = consumePendingConnection();
  if (pending) {
    // Capability-row failures (the user clicked Connect Outlook /
    // Connect Gmail / etc.) are surfaced — the user did an
    // explicit action and deserves feedback. The callback shows
    // the error inline; settings won't show the new row, so re-
    // trying from settings is the next step.
    //
    // No `session.provider_refresh_token` pre-flight: Supabase's
    // same-provider signInWithOAuth path sometimes returns no new
    // refresh_token (Microsoft considers the existing identity-row
    // refresh_token still valid for the broader consent). The
    // server's connections-token resolver falls back to the
    // identity row's refresh_token in that case, so writing the
    // capability row WITHOUT a refresh_token is still useful —
    // future refreshes work via the fallback. Blocking the POST
    // here would prevent that recovery path.
    const capabilityResult = await postConnection(
      session,
      pending.capability,
      normalisedProvider,
      email,
      pending.scopes,
    );
    return {
      returnTo: pending.returnTo ?? null,
      capabilityError: capabilityResult.ok
        ? null
        : capabilityResult.message ?? "Could not save connection",
    };
  }

  // Fresh sign-in with no pending-connection flag — write only the
  // identity row. Capability rows (email / calendar) are written
  // only after the user explicitly clicks Connect on
  // /settings/account, which sets the pending-connection flag
  // handled above. We don't speculatively grant capabilities at
  // sign-in because the login page only requests identity scopes
  // — asking for Mail.Read or Calendars.ReadWrite at sign-in
  // would prompt for permissions the user hasn't asked for yet.

  return {
    returnTo: null,
    capabilityError: null,
  };
}

export default function AuthCallbackPage(): React.JSX.Element {
  const router = useRouter();
  const { login, linkGmail } = useAuth();
  const [error, setError] = useState<string | null>(null);
  /**
   * When the error came from a capability-link POST (the user
   * clicked Connect Outlook / Gmail / etc.), they're already
   * signed in — bouncing back to /login is the wrong UX. We carry
   * a target settings URL so the recovery button takes them
   * somewhere actionable.
   */
  const [errorCta, setErrorCta] = useState<{ label: string; href: string }>({
    label: "Back to sign-in",
    href: "/login",
  });

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const rawState = url.searchParams.get("state");
    const errorParam = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    if (errorParam) {
      setError(
        errorParam === "access_denied"
          ? "Sign-in was cancelled."
          : errorDescription || `Provider returned an error: ${errorParam}`,
      );
      return;
    }

    // Discriminator between the legacy custom Google flow and the new
    // Supabase flow: the legacy flow ships a base64-encoded JSON state
    // we control; Supabase ships its own opaque state. Try to decode
    // first — if it parses, route to legacy; else assume Supabase.
    const legacyState = rawState ? decodeState(rawState) : null;

    if (legacyState) {
      handleLegacyCallback(legacyState, code, url);
      return;
    }

    if (!isSupabaseConfigured()) {
      setError("Sign-in could not be verified (missing state).");
      return;
    }

    void (async () => {
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError("Sign-in is not configured.");
        return;
      }
      try {
        // The SDK has `detectSessionInUrl: false` (see lib/supabase.ts)
        // so this page is the *only* path that consumes the PKCE code.
        // Belt-and-braces: if a prior tab already exchanged (e.g. the
        // user opened the callback URL twice), `getSession` returns
        // the existing session and we skip the second exchange —
        // which would fail with "PKCE code verifier not found in
        // storage" because the verifier is single-use.
        let session: Session | null;
        const { data: existing } = await supabase.auth.getSession();
        session = existing.session;
        if (!session && code) {
          const { data, error: exchangeError } =
            await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
          session = data.session;
        }
        if (!session) {
          setError(
            "Sign-in could not be completed. The provider redirect did not return a session.",
          );
          return;
        }
        const { returnTo, capabilityError } = await syncConnections(session);
        if (capabilityError) {
          // The user clicked Connect for a capability and the
          // resulting `/connections` POST failed. Surface inline +
          // route the recovery button to /settings/account so a
          // re-try is a single click from here.
          setError(capabilityError);
          setErrorCta({
            label: "Open Settings",
            href: returnTo ?? "/settings/account",
          });
          return;
        }
        router.replace(returnTo ?? "/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign-in failed.");
      }
    })();

    function handleLegacyCallback(
      decoded: NonNullable<ReturnType<typeof decodeState>>,
      legacyCode: string | null,
      legacyUrl: URL,
    ): void {
      // Relay branch: this deployment is acting as the OAuth proxy for a
      // preview deployment. Don't touch sessionStorage here — the
      // preview owns the CSRF token. Just validate the target origin and
      // bounce the code + state through unchanged.
      if (decoded.origin !== window.location.origin) {
        if (!isAllowlistedRelayOrigin(decoded.origin)) {
          setError(
            "Sign-in could not be verified (untrusted relay target). Please try again.",
          );
          return;
        }
        const target = new URL("/auth/callback", decoded.origin);
        target.search = legacyUrl.search;
        window.location.replace(target.toString());
        return;
      }

      const { expectedCsrf, returnTo } = consumeOAuthState();
      if (!legacyCode) {
        setError("No authorization code received from Google.");
        return;
      }
      if (!expectedCsrf || decoded.csrf !== expectedCsrf) {
        setError(
          "Sign-in could not be verified (state mismatch). Please try again.",
        );
        return;
      }
      void (async () => {
        try {
          const redirectUri = getOAuthRedirectUri();
          const flow = decoded.flow ?? "primary";
          if (flow === "gmail") {
            await linkGmail(legacyCode, redirectUri);
          } else {
            await login(legacyCode, redirectUri);
          }
          router.replace(returnTo);
        } catch (err) {
          if (err instanceof TypeError && err.message === "Failed to fetch") {
            setError(
              "Unable to reach the API server. Sign-in requires a running backend.",
            );
          } else {
            setError(err instanceof Error ? err.message : "Sign-in failed.");
          }
        }
      })();
    }
  }, [login, linkGmail, router]);

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-6 text-center">
          <AppLogo className="mx-auto h-12 w-12" />
          <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-left text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <Button onClick={() => router.replace(errorCta.href)}>
            {errorCta.label}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="flex items-center gap-3 text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        <span>Completing sign-in…</span>
      </div>
    </main>
  );
}
