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
  /**
   * The provider the user clicked Connect for. Required in the
   * cross-provider case (Microsoft-primary user clicking Connect
   * Google Calendar): after `linkIdentity("google")` lands here,
   * `session.user.app_metadata.provider` still reflects the original
   * Microsoft sign-in, so without this hint we'd write the capability
   * row for the wrong provider. Optional for backwards compat with
   * pending flags written by an older client build.
   */
  provider?: "google" | "microsoft";
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
  /**
   * Whether this Connect click used `signInWithOAuth` or
   * `linkIdentity`. Drives whether the callback exchanges the
   * code for a new session (signin — wanted for getting the
   * provider's refresh_token) or trusts the existing session
   * (link — exchanging would sign the user in as the linked
   * provider's owner, swapping their session out from under
   * them, which a recent user report confirmed in the wild).
   */
  flow?: "signin" | "link";
  /**
   * The user id that initiated the Connect flow. Set so the
   * callback can detect "the session was swapped under me" —
   * happens if Supabase's link callback lands on a different
   * user (e.g. when the linked identity already belongs to a
   * separate itinly login). When detected, surfaces a clear
   * error instead of silently writing tokens against the wrong
   * user-id.
   */
  expectedUserId?: string;
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

/**
 * Read the pending-connection flag WITHOUT clearing it. Used by the
 * pre-session branching logic that needs to know the flow type
 * (signin vs link) before `syncConnections` runs and consumes the
 * flag. The actual write happens later via `consumePendingConnection`.
 */
function peekPendingConnection(): PendingConnection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_CONNECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingConnection;
    if (parsed.capability !== "email" && parsed.capability !== "calendar") {
      return null;
    }
    return parsed;
  } catch {
    return null;
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
  // Supabase often elides `provider_refresh_token` for returning-
  // user OAuth flows — the server falls back to the identity-row's
  // refresh token in `connections-token.ts` when the capability
  // row's slot is empty. No client-side warn here; server-side
  // diagnostics (gated behind `DEBUG_CONNECTIONS=1`) cover the
  // observability need when ops needs to trace a refresh-token
  // preservation regression.
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
    // Cross-provider capability case: the user is signed in as one
    // provider (e.g. Microsoft) and clicked Connect for a different
    // one (Google). `linkIdentity` attached the new identity to the
    // existing user, but `app_metadata.provider` + `session.user.email`
    // still reflect the ORIGINAL sign-in. Trust the explicit
    // `pending.provider` over the loose session fields, and pull the
    // capability's `accountEmail` from the matching identity entry —
    // that's the email of the mailbox / calendar account that was
    // just authorized, which is what the connection row needs to
    // identify "which Google mailbox is this row for?"
    const capabilityProvider = pending.provider ?? normalisedProvider;
    const supabaseProviderKey =
      capabilityProvider === "microsoft" ? "azure" : "google";
    const linkedIdentity = (session.user.identities ?? []).find(
      (i) => i.provider === supabaseProviderKey,
    );
    const linkedEmail = (() => {
      const data = linkedIdentity?.identity_data as
        | Record<string, unknown>
        | undefined;
      const e = data?.email;
      return typeof e === "string" ? e : null;
    })();
    const capabilityEmail = linkedEmail ?? email;

    // Identity row for the LINKED provider — write it explicitly so
    // a Microsoft-primary user who just connected Google Calendar
    // gets a Google identity row stamped with the Google account's
    // email (not the Microsoft session email).
    if (capabilityProvider !== normalisedProvider) {
      await postConnection(
        session,
        "identity",
        capabilityProvider,
        capabilityEmail,
      );
    }

    // Capability-row failures (the user clicked Connect Outlook /
    // Connect Gmail / etc.) are surfaced — the user did an
    // explicit action and deserves feedback. The callback shows
    // the error inline; settings won't show the new row, so re-
    // trying from settings is the next step.
    const capabilityResult = await postConnection(
      session,
      pending.capability,
      capabilityProvider,
      capabilityEmail,
      pending.scopes,
    );
    return {
      returnTo: pending.returnTo ?? null,
      capabilityError: capabilityResult.ok
        ? null
        : capabilityResult.message ?? "Couldn't save connection",
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
  const [error, setError] = useState<React.ReactNode | null>(null);
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
      // Supabase reports "this Microsoft account already belongs to a
      // different itinly login" as `error=identity_already_exists` (or
      // a message containing "already linked"). Replace the default
      // tooltip-style description with an actionable explanation —
      // until we ship the account-merge flow (see backlog in README),
      // the user's only path forward is to sign out + sign in as the
      // other account.
      const description = errorDescription ?? "";
      const isAlreadyLinked =
        errorParam === "identity_already_exists" ||
        errorParam === "user_already_exists" ||
        /already linked/i.test(description) ||
        /already.*registered/i.test(description);
      if (isAlreadyLinked) {
        setError(
          <div className="space-y-2">
            <p>
              That account is already registered as a separate itinly login.
            </p>
            <p className="font-medium">You have two options:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Sign out, sign back in with that other account, and use it
                directly. Each itinly login keeps its own trips and
                connections.
              </li>
              <li>
                Stay signed in here — you can still use{" "}
                <strong>this</strong> account&apos;s email + calendar
                connections in /settings/account.
              </li>
            </ul>
            <p className="text-xs opacity-80">
              Account merging (combining trips, share rules, and connections
              into one login) is on the roadmap — see the README backlog.
            </p>
          </div>,
        );
        setErrorCta({ label: "Back to settings", href: "/settings/account" });
        return;
      }
      setError(
        errorParam === "access_denied"
          ? "Sign-in was cancelled."
          : description || `Provider returned an error: ${errorParam}`,
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
        // Peek at the pending-connection flag before we touch any
        // session state — `consumePendingConnection` is called later
        // inside `syncConnections` but we need to know the flow type
        // (sign-in vs identity-link) here to pick the right path:
        //
        //  * `signin` (or no pending) → exchange the code. This is
        //    the only Supabase path that surfaces
        //    `provider_refresh_token`, which the server needs to
        //    refresh capability-scoped access tokens later. PR #321.
        //
        //  * `link` → DON'T exchange. `linkIdentity` was supposed to
        //    attach the new provider to the *current* user, but if
        //    we exchange the code Supabase signs the user in as the
        //    *linked* provider's account, replacing their session.
        //    A real user hit this when, signed in as Microsoft,
        //    they clicked Connect Google Calendar — and ended up
        //    signed in as the Google account with no calendar
        //    capability written. Reading the existing session via
        //    getSession keeps them signed in as themselves; the
        //    capability row is still written with whatever tokens
        //    are on the session (best-effort).
        const pendingPeek = peekPendingConnection();
        let session: Session | null = null;
        if (code && pendingPeek?.flow !== "link") {
          try {
            const { data, error: exchangeError } =
              await supabase.auth.exchangeCodeForSession(code);
            if (exchangeError) throw exchangeError;
            session = data.session;
          } catch (err) {
            // PKCE single-use; another tab may have already consumed
            // the code. Fall through to getSession to pick up that
            // tab's result. Log so we can spot prod-side double-tabs.
            console.warn(
              "[auth-callback] exchangeCodeForSession failed; falling back to getSession:",
              err instanceof Error ? err.message : err,
            );
          }
        }
        if (!session) {
          const { data: existing } = await supabase.auth.getSession();
          session = existing.session;
        }
        if (!session) {
          setError(
            "Sign-in could not be completed. The provider redirect did not return a session.",
          );
          return;
        }
        // Defence in depth: if Supabase landed the link callback on
        // a DIFFERENT user than the one who initiated it (the
        // "linked identity already owned by another user" path),
        // bail before writing tokens against the wrong user-id.
        if (
          pendingPeek?.flow === "link" &&
          pendingPeek.expectedUserId &&
          session.user.id !== pendingPeek.expectedUserId
        ) {
          consumePendingConnection();
          setError(
            <div className="space-y-2">
              <p>
                That account is already linked to a different itinly
                login. Linking would replace your current session.
              </p>
              <p className="text-xs opacity-80">
                Sign out and sign in directly as the other account, or
                stay here and use this account&apos;s connections in
                /settings/account.
              </p>
            </div>,
          );
          setErrorCta({ label: "Back to settings", href: "/settings/account" });
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
            <div className="min-w-0 flex-1">{error}</div>
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
