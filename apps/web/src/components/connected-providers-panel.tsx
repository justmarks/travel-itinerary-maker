"use client";

/**
 * Manages the user's Supabase identities — the OAuth providers
 * (Google, Microsoft) linked to their single Supabase user record.
 *
 * Why this exists: same email signing in with Google and Microsoft
 * separately creates *two* Supabase user accounts by default (manual
 * linking, per `docs/supabase-auth-setup.md` §5). This panel lets a
 * user start with one provider, then ADD another to the same Supabase
 * user via `linkIdentity()` — both providers then resolve to the
 * same `user.id`, the same trips, the same connections.
 *
 * Linking flow:
 *   1. User clicks "Link Microsoft" (only shown when not already linked).
 *   2. `supabase.auth.linkIdentity({ provider: "azure" })` runs the
 *      OAuth dance with the *current* session attached, so the
 *      provider's response is associated with the existing user
 *      rather than creating a new one.
 *   3. Provider redirect lands back on `/auth/callback`, which
 *      already handles "session-now-has-extra-identity" the same way
 *      it handles fresh sign-ins.
 *
 * Unlinking:
 *   - `unlinkIdentity(identity)` requires the user to keep at least
 *     one identity. The UI disables the button on the last remaining
 *     identity and surfaces a toast if the call fails.
 *   - Unlinking the identity invalidates the provider's stored
 *     refresh token, which kills any email / calendar capability that
 *     depends on it. To avoid leaving dead capability rows behind
 *     (Settings would show "Connected" but every feature 401s), we
 *     confirm with the user listing the affected capabilities and
 *     then DELETE the capability rows before calling
 *     `unlinkIdentity`.
 */

import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, useConnections } from "@itinly/api-client";
import { Button } from "@/components/ui/button";
import { getSupabaseClient } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm-dialog";
import { sortByPrimaryEmail } from "@itinly/shared";
import { Loader2 } from "lucide-react";

type LinkableProvider = "google" | "azure";
type ConnectionsProvider = "google" | "microsoft";
type ConnectionsCapability = "identity" | "email" | "calendar";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  azure: "Microsoft",
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

interface PublicConnection {
  id: string;
  provider: ConnectionsProvider;
  capability: ConnectionsCapability;
  accountEmail: string;
  status: "active" | "revoked";
}

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Supabase exposes Microsoft as `azure`; our `/connections` rows store
 * it as `microsoft`. This panel deals in both, so normalise at the
 * boundary.
 */
function toConnectionsProvider(
  identityProvider: string,
): ConnectionsProvider | null {
  if (identityProvider === "azure") return "microsoft";
  if (identityProvider === "google") return "google";
  return null;
}

function identityEmail(identity: UserIdentity): string {
  const data = identity.identity_data as Record<string, unknown> | undefined;
  const email = data?.email;
  return typeof email === "string" ? email : "";
}

/**
 * Friendly noun for the per-capability cascade summary in the
 * unlink-confirmation dialog. Renders the same label the user clicked
 * in /settings/account a moment ago (Outlook mail / Outlook Calendar
 * vs Gmail / Google Calendar) so the cascade language stays in sync.
 */
function capabilityLabel(
  provider: ConnectionsProvider,
  capability: ConnectionsCapability,
): string {
  if (provider === "microsoft") {
    if (capability === "email") return "Outlook Mail";
    if (capability === "calendar") return "Outlook Calendar";
  } else {
    if (capability === "email") return "Gmail";
    if (capability === "calendar") return "Google Calendar";
  }
  return capability;
}

export function ConnectedProvidersPanel(): React.JSX.Element {
  const { accessToken, user } = useAuth();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  // Share connections state with `ConnectedServicesPanel` via the
  // same React Query cache key. When this panel cascade-unlinks a
  // provider it invalidates the query so the services panel re-renders
  // without the just-deleted capability rows — no manual page refresh.
  const { data: connectionsData } = useConnections();
  const connections: PublicConnection[] =
    connectionsData?.connections.filter((c) => c.status === "active") ?? [];
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setLoadError("Sign-in is not configured.");
      return;
    }
    let cancelled = false;
    void supabase.auth.getUserIdentities().then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setLoadError(error?.message ?? "Couldn't load sign-in methods.");
        return;
      }
      setIdentities(data.identities ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {loadError}
      </div>
    );
  }

  if (identities === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading sign-in methods…
      </div>
    );
  }

  const linkedProviders = new Set(identities.map((i) => i.provider));
  const linkableProviders: LinkableProvider[] = (
    ["google", "azure"] as const
  ).filter((p) => !linkedProviders.has(p));

  async function handleLink(provider: LinkableProvider): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusyProvider(provider);
    try {
      // `linkIdentity` reuses the current session, so the provider's
      // OAuth response is attached to the existing user instead of
      // creating a new one. Microsoft requires `User.Read` for the
      // Graph photo fetch we do post-sign-in (see lib/auth.tsx) —
      // request the same scopes the login page does.
      const options: { redirectTo: string; scopes?: string } = {
        redirectTo: `${window.location.origin}/auth/callback`,
      };
      if (provider === "azure") {
        options.scopes = "openid email profile offline_access User.Read";
      }
      const { error } = await supabase.auth.linkIdentity({ provider, options });
      if (error) throw error;
      // Browser redirects to the provider; nothing else to do here.
    } catch (err) {
      toast.error("Couldn't link account", {
        description:
          err instanceof Error ? err.message : "Unknown error",
      });
      setBusyProvider(null);
    }
  }

  async function handleUnlink(identity: UserIdentity): Promise<void> {
    if (identities && identities.length <= 1) {
      toast.error("Can't unlink", {
        description:
          "You need at least one sign-in method to access your account.",
      });
      return;
    }

    const connectionsProvider = toConnectionsProvider(identity.provider);
    // Cascade list: every active email / calendar capability row tied
    // to this provider. Identity rows are handled implicitly — once
    // Supabase unlinks the identity, the matching identity-row's
    // refresh token can no longer be refreshed and would leak into
    // every capability lookup (the fallback path in
    // `connections-token.ts` reads from the identity row). We drop
    // both the capability rows the user can see in Settings AND the
    // identity row for the same provider so the table reflects
    // reality after unlink.
    const affected = connectionsProvider
      ? connections.filter(
          (c) =>
            c.provider === connectionsProvider &&
            (c.capability === "email" || c.capability === "calendar"),
        )
      : [];
    const cascadeLabels = affected.map((c) =>
      capabilityLabel(c.provider, c.capability),
    );

    const providerName = providerLabel(identity.provider);
    const description =
      cascadeLabels.length > 0
        ? `${providerName} is also powering: ${cascadeLabels.join(", ")}. Unlinking will disconnect ${cascadeLabels.length === 1 ? "it" : "these"} too — you'll need to reconnect from Settings to use ${cascadeLabels.length === 1 ? "it" : "them"} again.`
        : `Once unlinked, you'll need to sign in with another method to access this account.`;

    const ok = await confirm({
      title: `Unlink ${providerName}?`,
      description,
      confirmText: "Unlink",
      destructive: true,
    });
    if (!ok) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusyProvider(identity.provider);

    const queryKey = queryKeys.connections;
    // Optimistic identity-row state; rolled back on error.
    const prev = identities ?? [];
    setIdentities(prev.filter((i) => i.identity_id !== identity.identity_id));

    // Optimistic connections-cache update: drop every row for this
    // provider from the shared React Query cache so the services
    // panel re-renders without the cascading rows immediately. Same
    // queryKey both panels read, so the update propagates to both
    // without an event bus.
    if (connectionsProvider) {
      queryClient.setQueryData<{ connections: PublicConnection[] }>(
        queryKey,
        (old) =>
          old
            ? {
                connections: old.connections.filter(
                  (c) => c.provider !== connectionsProvider,
                ),
              }
            : old,
      );
    }

    try {
      // DELETE every connection row tied to this provider — both the
      // capability rows we listed in the confirm AND the identity row.
      // Server is the source of truth for the rows; doing this
      // server-side first means the next /connections fetch shows the
      // post-unlink reality even if the user reloads mid-flight.
      if (accessToken && connectionsProvider) {
        const rowsToDelete = connections.filter(
          (c) => c.provider === connectionsProvider,
        );
        for (const row of rowsToDelete) {
          const res = await fetch(`${API_BASE_URL}/connections/${row.id}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!res.ok && res.status !== 204 && res.status !== 404) {
            throw new Error(
              `Failed to remove ${row.provider}/${row.capability}: ${res.status}`,
            );
          }
        }
      }

      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) throw error;
      // Refetch from server so the cache reflects post-cascade truth
      // (in case the optimistic write missed any rows the server
      // server-side cascaded out from under us).
      await queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      setIdentities(prev);
      // Refetch instead of restoring the snapshot — the loop may
      // have completed some DELETEs server-side before failing, so
      // restoring `prevConnectionsCache` would show "still connected"
      // for rows that are actually gone. Invalidating forces the
      // services panel to reconcile against truth.
      await queryClient.invalidateQueries({ queryKey });
      toast.error("Couldn't unlink account", {
        description:
          err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h2 className="text-sm font-medium">Linked sign-in methods</h2>
        <p className="text-sm text-muted-foreground">
          Sign in with any of these — they all point to the same trips.
        </p>
        <ul className="space-y-2">
          {sortByPrimaryEmail(
            identities,
            identityEmail,
            user?.email ?? null,
          ).map((identity) => {
            const email = identityEmail(identity);
            const canUnlink = identities.length > 1;
            const isBusy = busyProvider === identity.provider;
            return (
              <li
                key={identity.identity_id}
                className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    {providerLabel(identity.provider)}
                  </div>
                  {email && (
                    <div className="truncate text-xs text-muted-foreground">
                      {email}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canUnlink || isBusy}
                  onClick={() => void handleUnlink(identity)}
                  title={
                    !canUnlink
                      ? "You need at least one sign-in method."
                      : undefined
                  }
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Unlinking…
                    </>
                  ) : (
                    "Unlink"
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      {linkableProviders.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium">Add another sign-in method</h2>
          <p className="text-sm text-muted-foreground">
            Link another provider to the same account so you can sign in
            with whichever you have handy.
          </p>
          <div className="flex flex-wrap gap-2">
            {linkableProviders.map((provider) => (
              <Button
                key={provider}
                variant="outline"
                size="sm"
                disabled={busyProvider === provider}
                onClick={() => void handleLink(provider)}
              >
                Link {providerLabel(provider)}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
