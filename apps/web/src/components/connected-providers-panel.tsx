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
 */

import { useEffect, useState } from "react";
import type { UserIdentity } from "@supabase/supabase-js";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getSupabaseClient } from "@/lib/supabase";

type LinkableProvider = "google" | "azure";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  azure: "Microsoft",
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function identityEmail(identity: UserIdentity): string {
  const data = identity.identity_data as Record<string, unknown> | undefined;
  const email = data?.email;
  return typeof email === "string" ? email : "";
}

export function ConnectedProvidersPanel(): React.JSX.Element {
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
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
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
    const supabase = getSupabaseClient();
    if (!supabase) return;
    setBusyProvider(identity.provider);
    // Optimistic: drop from local state immediately, restore on error.
    const prev = identities ?? [];
    setIdentities(prev.filter((i) => i.identity_id !== identity.identity_id));
    try {
      const { error } = await supabase.auth.unlinkIdentity(identity);
      if (error) throw error;
    } catch (err) {
      setIdentities(prev);
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
          {identities.map((identity) => {
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
                  Unlink
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
