"use client";

import { HardDrive } from "lucide-react";
import { useConnections } from "@itinly/api-client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";
import { DRIVE_SCOPE, requestAdditionalScopes } from "@/lib/oauth";

/**
 * Banner shown on the trips dashboard when a signed-in user did not
 * grant the Drive scope at consent (e.g. they unticked the checkbox).
 * Without Drive, owner-side trip operations fail and the dashboard can
 * only render trips that have been *shared* with the user. The CTA
 * re-runs the OAuth redirect with `prompt=consent` so the user can
 * re-grant; `requestAdditionalScopes` already preserves any other scopes
 * (Calendar, etc.) via `include_granted_scopes=true`.
 *
 * Suppressed for:
 *   - Demo mode (no real Drive call ever runs)
 *   - Users with the Drive scope already granted (legacy happy path)
 *   - **Supabase-authed users** — they're routed to `SupabaseStorage`
 *     (Postgres) by the drive-mode resolver, so Drive scope doesn't
 *     apply. The presence of ANY `/api/v1/connections` row signals
 *     they're on the new auth path; the banner stays out of their way.
 *
 * Returns null in all suppression cases so callers can drop it
 * unconditionally above their list.
 */
export function DriveScopeBanner({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile";
}): React.JSX.Element | null {
  const { hasScope, isAuthenticated, isLoading } = useAuth();
  const isDemo = useDemoMode();
  // Skip the /connections fetch when not authed; cuts an unnecessary
  // call on the signed-out marketing pages.
  const { data: connectionsData, isLoading: connectionsLoading } =
    useConnections(isAuthenticated && !isDemo);

  if (isDemo) return null;
  if (isLoading) return null;
  if (!isAuthenticated) return null;
  if (hasScope(DRIVE_SCOPE)) return null;
  // Hide while we don't know yet — better a brief moment of no
  // banner than a flash of "Grant Drive" for a Supabase user.
  if (connectionsLoading) return null;
  // Any connection row = user is on the Supabase path = Postgres
  // storage, Drive irrelevant.
  if ((connectionsData?.connections ?? []).length > 0) return null;

  const handleClick = () => {
    const returnTo =
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : "/";
    requestAdditionalScopes([DRIVE_SCOPE], returnTo);
  };

  const isMobile = variant === "mobile";

  return (
    <div
      className={
        isMobile
          ? "mx-3 flex items-start gap-3 rounded-2xl border p-3 text-sm"
          : "mb-6 flex items-start gap-3 rounded-xl border p-4 text-sm"
      }
      style={{
        backgroundColor: "var(--status-warn-bg)",
        color: "var(--status-warn-fg)",
        borderColor: "var(--status-warn-rail)",
      }}
      role="status"
    >
      <HardDrive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="space-y-1">
          <p className="font-medium">Google Drive access not granted</p>
          <p className="opacity-90">
            Trips you create are stored in your Google Drive. Without
            Drive access you can still view trips others share with you,
            but you can&apos;t create or edit your own.
          </p>
        </div>
        <div>
          <Button
            type="button"
            size="sm"
            onClick={handleClick}
            className="self-start"
          >
            Grant Drive access
          </Button>
        </div>
      </div>
    </div>
  );
}
