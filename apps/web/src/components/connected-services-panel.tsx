"use client";

/**
 * Manages the user's per-capability OAuth links — distinct from the
 * sign-in-methods panel that handles Supabase identities. This is
 * where the user clicks **Connect Microsoft Outlook** to grant
 * `Mail.Read` for email scanning, or **Connect Microsoft Calendar**
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
    markPendingConnection({
      capability,
      // Bounce back to the settings page so the user sees their new
      // connection in the list without manual navigation.
      returnTo:
        typeof window !== "undefined" && window.location.pathname.startsWith("/m")
          ? "/m/settings/account"
          : "/settings/account",
    });
    try {
      // `linkIdentity` adds a new OAuth identity (with the requested
      // scopes) to the CURRENT signed-in user — without rotating the
      // session. `signInWithOAuth` would instead re-sign-the-user-in,
      // which on the Microsoft path replaces the existing Google
      // session with a fresh Microsoft one and orphans the user's
      // existing connections rows under the old UUID.
      //
      // Requires Supabase "Manual identity linking" to be enabled
      // (docs/supabase-auth-setup.md §5) — already done.
      const { error } = await supabase.auth.linkIdentity({
        provider,
        options: {
          scopes,
          redirectTo: `${window.location.origin}/auth/callback`,
        },
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
            Connect Outlook
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
            Connect Microsoft Calendar
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
