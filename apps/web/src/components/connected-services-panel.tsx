"use client";

/**
 * Manages the user's per-capability OAuth links — distinct from the
 * sign-in-methods panel that handles Supabase identities. This is
 * where the user clicks **Connect Outlook mail** to grant
 * `Mail.Read` for email scanning, or **Connect Outlook Calendar**
 * to grant `Calendars.ReadWrite` for trip-segment sync.
 *
 * Each connection row in `/api/v1/connections` has a
 * `(provider, capability, accountEmail)` triple. This panel groups
 * those rows by capability and offers Connect / Disconnect controls
 * per provider per capability.
 *
 * Mechanism (Phase 4c):
 *   Connect → `markPendingConnection({ capability, returnTo })`
 *           → `supabase.auth.signInWithOAuth({ scopes: <the right
 *              set>, redirectTo: "/auth/callback" })`
 *           → callback writes the row + bounces back here.
 *   Disconnect → `DELETE /api/v1/connections/:id` → row is
 *                soft-deleted (status='revoked'); list refreshes.
 *
 * Today this panel only surfaces Microsoft. Google connections live
 * on the legacy `TokenStore` path (Gmail) / `req.accessToken` path
 * (Calendar) and migrate to `/connections` in subsequent commits.
 */

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { markPendingConnection } from "@/app/auth/callback/page";
import { startGmailLink, isGmailLinkConfigured } from "@/lib/oauth";
import { describeError } from "@/lib/api-error";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

interface PublicConnection {
  id: string;
  provider: "google" | "microsoft";
  capability: "identity" | "email" | "calendar";
  accountEmail: string;
  scopes: string[];
  status: "active" | "revoked";
}

interface ConnectionsResponse {
  connections: PublicConnection[];
}

const PROVIDER_LABELS = {
  google: "Google",
  microsoft: "Microsoft",
} as const;

const MICROSOFT_BASE_SCOPES = "openid email profile offline_access User.Read";
const MICROSOFT_MAIL_SCOPES = `${MICROSOFT_BASE_SCOPES} Mail.Read`;
const MICROSOFT_CALENDAR_SCOPES = `${MICROSOFT_BASE_SCOPES} Calendars.ReadWrite`;
// `email profile` are OIDC sign-in scopes; `https://...calendar` is the
// Google Calendar OAuth scope on the primary client. Asking for both
// on the same sign-in gets the user a calendar-capable access token
// the server can refresh via the primary OAuth client.
const GOOGLE_CALENDAR_SCOPES =
  "openid email profile https://www.googleapis.com/auth/calendar";

async function fetchConnections(accessToken: string): Promise<PublicConnection[]> {
  const res = await fetch(`${API_BASE_URL}/connections`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to list connections: ${res.status}`);
  }
  const data = (await res.json()) as ConnectionsResponse;
  return data.connections.filter((c) => c.status === "active");
}

async function deleteConnection(
  accessToken: string,
  connectionId: string,
): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/connections/${connectionId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`Failed to disconnect: ${res.status}`);
  }
}

export function ConnectedServicesPanel(): React.JSX.Element {
  const { accessToken } = useAuth();
  const [connections, setConnections] = useState<PublicConnection[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const list = await fetchConnections(accessToken);
      setConnections(list);
      setLoadError(null);
    } catch (err) {
      setLoadError(describeError(err));
    }
  }, [accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startConnect(
    provider: "azure" | "google",
    capability: "email" | "calendar",
    scopes: string,
  ): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) {
      toast.error("Couldn't start sign-in", {
        description: "Sign-in is not configured for this environment.",
      });
      return;
    }
    const providerKey = provider === "azure" ? "microsoft" : "google";
    setBusyAction(`connect-${providerKey}-${capability}`);
    try {
      // Two paths depending on whether the user is already linked to
      // this provider:
      //
      //   - **Different provider** (e.g. user signed in with Google,
      //     clicking Connect Outlook): `linkIdentity` adds the new
      //     Azure identity to the existing user without rotating the
      //     session. Requires Supabase "Manual identity linking"
      //     (docs/supabase-auth-setup.md §5).
      //
      //   - **Same provider** (e.g. user signed in with Microsoft,
      //     clicking Connect Outlook): `linkIdentity` would reject
      //     with "Identity is already linked." Instead we run
      //     `signInWithOAuth` with the broader scope set —
      //     Microsoft / Google's manual identity linking matches the
      //     same-email-same-provider case to the existing user, so
      //     the session UUID stays stable. The newly issued token
      //     carries the requested scopes via incremental consent.
      //
      // Either path lands at /auth/callback which reads the pending-
      // connection flag and writes the capability row.
      const supabaseClient = supabase;
      const { data: userData } = await supabaseClient.auth.getUser();
      const linkedProviders = new Set(
        (userData.user?.identities ?? []).map((i) => i.provider),
      );
      const alreadyLinked = linkedProviders.has(provider);
      // Stamp the pending flag NOW (after we know the flow type) so
      // the callback can branch its session-selection logic. Without
      // the flow hint, the callback would unconditionally
      // exchange-code-for-session on a `linkIdentity` callback and
      // sign the user in as the *linked* provider's account,
      // swapping them out of their original session.
      markPendingConnection({
        capability,
        // Explicit provider so the callback writes the capability row
        // for THIS provider regardless of which one the existing
        // session reports as `app_metadata.provider`. Without this,
        // a Microsoft-primary user connecting Google Calendar ended
        // up with the capability row stamped microsoft + Microsoft
        // email (and no Google calendar row at all).
        provider: providerKey,
        scopes: scopes.split(" ").filter(Boolean),
        returnTo:
          typeof window !== "undefined" && window.location.pathname.startsWith("/m")
            ? "/m/settings/account"
            : "/settings/account",
        flow: alreadyLinked ? "signin" : "link",
        expectedUserId: userData.user?.id,
      });

      // Google requires `access_type=offline&prompt=consent` to
      // include a refresh_token in the OAuth response. Without the
      // refresh token, the connection row can't refresh once the
      // 1-hour access token expires, and the next feature call
      // returns "no refresh token; needs re-link." Microsoft
      // returns a refresh token automatically when `offline_access`
      // is in the scope set (which our Connect scopes already are).
      const oauthOptions: {
        scopes: string;
        redirectTo: string;
        queryParams?: Record<string, string>;
      } = {
        scopes,
        redirectTo: `${window.location.origin}/auth/callback`,
      };
      // Pull the already-linked identity's email so we can pin the
      // Connect-capability OAuth to THAT specific account when this
      // is a same-provider flow. Without this, a Microsoft-primary
      // user with multiple Microsoft accounts (work + personal) sees
      // the account picker on Connect Outlook and can accidentally
      // pick a different account — the resulting capability row gets
      // stamped with that different account's email, and the
      // already-granted scopes on it cause Microsoft to elide the
      // refresh token. Result: a `NULL`-token row sitting next to a
      // working identity row, scan / sync feature fails with
      // "no refresh token".
      const existingIdentityEmail = (() => {
        const match = (userData.user?.identities ?? []).find(
          (i) => i.provider === provider,
        );
        const data = match?.identity_data as
          | Record<string, unknown>
          | undefined;
        const e = data?.email;
        return typeof e === "string" ? e : undefined;
      })();

      if (provider === "google") {
        oauthOptions.queryParams = {
          access_type: "offline",
          prompt: "consent",
        };
        // Google accepts `login_hint` the same way Microsoft does.
        // For a same-provider Connect (alreadyLinked=true) we want
        // the new OAuth round to bind to the user's existing Google
        // account, not a random one from the browser cache. This
        // doesn't suppress the consent screen — `prompt=consent`
        // still forces it — it only narrows which account that
        // consent applies to.
        if (alreadyLinked && existingIdentityEmail) {
          oauthOptions.queryParams.login_hint = existingIdentityEmail;
        }
      } else if (provider === "azure") {
        // Same-provider Connect: pin the OAuth to the existing
        // Microsoft account via `login_hint`. Drops the account
        // picker entirely for that case so users with multiple
        // Microsoft accounts (e.g. work + personal) can't pick the
        // wrong one and silently create a tokenless capability row.
        //
        // Cross-provider link (alreadyLinked=false): keep
        // `prompt=select_account` so users with multiple Microsoft
        // accounts can choose which one to LINK. Identical to the
        // login-page behaviour added in #323.
        if (alreadyLinked && existingIdentityEmail) {
          oauthOptions.queryParams = {
            login_hint: existingIdentityEmail,
          };
        } else {
          oauthOptions.queryParams = {
            prompt: "select_account",
          };
        }
      }
      const { error } = alreadyLinked
        ? await supabaseClient.auth.signInWithOAuth({
            provider,
            options: oauthOptions,
          })
        : await supabaseClient.auth.linkIdentity({
            provider,
            options: oauthOptions,
          });
      if (error) throw error;
      // Browser is redirecting — the next render won't happen.
    } catch (err) {
      setBusyAction(null);
      toast.error("Couldn't start sign-in", {
        description: describeError(err),
      });
    }
  }

  async function handleDisconnect(connection: PublicConnection): Promise<void> {
    if (!accessToken) return;
    setBusyAction(`disconnect-${connection.id}`);
    // Optimistic: drop from local state immediately. Restore on error.
    const previous = connections;
    setConnections((curr) => curr?.filter((c) => c.id !== connection.id) ?? null);
    try {
      await deleteConnection(accessToken, connection.id);
    } catch (err) {
      setConnections(previous);
      toast.error("Couldn't disconnect", {
        description: describeError(err),
      });
    } finally {
      setBusyAction(null);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {loadError}
      </div>
    );
  }

  if (connections === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        Loading connected services…
      </div>
    );
  }

  const linkedByCapability: Record<"email" | "calendar", PublicConnection[]> = {
    email: connections.filter((c) => c.capability === "email"),
    calendar: connections.filter((c) => c.capability === "calendar"),
  };
  const microsoftEmailLinked = linkedByCapability.email.some(
    (c) => c.provider === "microsoft",
  );
  const googleEmailLinked = linkedByCapability.email.some(
    (c) => c.provider === "google",
  );
  const microsoftCalendarLinked = linkedByCapability.calendar.some(
    (c) => c.provider === "microsoft",
  );
  const googleCalendarLinked = linkedByCapability.calendar.some(
    (c) => c.provider === "google",
  );

  function handleConnectGmail(): void {
    if (!isGmailLinkConfigured()) {
      toast.error("Gmail is not configured", {
        description:
          "The Gmail OAuth client isn't set on this build. Contact the site owner.",
      });
      return;
    }
    setBusyAction("connect-google-email");
    try {
      // startGmailLink redirects via window.location — control doesn't
      // come back from this call. The legacy callback branch (flow="gmail")
      // handles the round-trip, which now writes a `connections` row for
      // Supabase-authed users via the auth route's Phase 4c handler.
      const returnTo =
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/m")
          ? "/m/settings/account"
          : "/settings/account";
      startGmailLink(returnTo);
    } catch (err) {
      setBusyAction(null);
      toast.error("Couldn't start Gmail link", {
        description: describeError(err),
      });
    }
  }

  return (
    <div className="space-y-6">
      <CapabilitySection
        title="Email"
        description="Scan your mailbox for travel confirmations so trips auto-fill from forwarded receipts."
        connections={linkedByCapability.email}
        busyAction={busyAction}
        onDisconnect={handleDisconnect}
      >
        {!googleEmailLinked && (
          <Button
            variant="outline"
            size="sm"
            disabled={busyAction === "connect-google-email"}
            onClick={handleConnectGmail}
          >
            Connect Gmail
          </Button>
        )}
        {!microsoftEmailLinked && (
          <Button
            variant="outline"
            size="sm"
            disabled={busyAction === "connect-microsoft-email"}
            onClick={() =>
              void startConnect("azure", "email", MICROSOFT_MAIL_SCOPES)
            }
          >
            Connect Outlook mail
          </Button>
        )}
      </CapabilitySection>

      <CapabilitySection
        title="Calendar"
        description="Push trip segments to your calendar so they show up next to the rest of your week."
        connections={linkedByCapability.calendar}
        busyAction={busyAction}
        onDisconnect={handleDisconnect}
      >
        {!googleCalendarLinked && (
          <Button
            variant="outline"
            size="sm"
            disabled={busyAction === "connect-google-calendar"}
            onClick={() =>
              void startConnect("google", "calendar", GOOGLE_CALENDAR_SCOPES)
            }
          >
            Connect Google Calendar
          </Button>
        )}
        {!microsoftCalendarLinked && (
          <Button
            variant="outline"
            size="sm"
            disabled={busyAction === "connect-microsoft-calendar"}
            onClick={() =>
              void startConnect("azure", "calendar", MICROSOFT_CALENDAR_SCOPES)
            }
          >
            Connect Outlook calendar
          </Button>
        )}
      </CapabilitySection>
    </div>
  );
}

function CapabilitySection({
  title,
  description,
  connections,
  busyAction,
  onDisconnect,
  children,
}: {
  title: string;
  description: string;
  connections: PublicConnection[];
  busyAction: string | null;
  onDisconnect: (c: PublicConnection) => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {connections.length > 0 && (
        <ul className="space-y-2">
          {connections.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{PROVIDER_LABELS[c.provider]}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.accountEmail}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={busyAction === `disconnect-${c.id}`}
                onClick={() => onDisconnect(c)}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      )}
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
