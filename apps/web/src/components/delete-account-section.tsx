"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useConfirm } from "@/lib/confirm-dialog";
import { describeError } from "@/lib/api-error";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

/**
 * Danger-zone panel for the settings/account page. POSTs
 * `DELETE /api/v1/account` after an in-app confirm, then signs the
 * user out and bounces them to the home page. The endpoint is
 * irreversible — it wipes every Postgres row owned by the user,
 * revokes their refresh tokens at Google + Microsoft, and (when the
 * server has a Supabase service-role key) drops the Supabase Auth
 * row too.
 */
export function DeleteAccountSection(): React.JSX.Element {
  const { accessToken, logout } = useAuth();
  const confirm = useConfirm();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleDelete(): Promise<void> {
    const ok = await confirm({
      title: "Delete your account?",
      description:
        "This permanently deletes every trip, share link, email scan, " +
        "and calendar link tied to this account. We will also revoke our " +
        "access to your connected Google and Microsoft accounts. This " +
        "cannot be undone.",
      confirmText: "Delete forever",
      destructive: true,
    });
    if (!ok) return;
    if (!accessToken) {
      toast.error("Couldn't delete account", {
        description: "You're not signed in. Try refreshing the page.",
      });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/account`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.status !== 204) {
        let detail = `Status ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) detail = body.error;
        } catch {
          // ignore JSON parse failures
        }
        throw new Error(detail);
      }
      // Local cleanup. `logout` already calls `supabase.auth.signOut`
      // internally so we don't need to call it twice.
      logout();
      router.replace("/");
    } catch (err) {
      setBusy(false);
      toast.error("Couldn't delete account", {
        description: describeError(err),
      });
    }
  }

  return (
    <section
      className="rounded-md border p-4"
      style={{
        borderColor: "var(--status-danger-fg)",
        backgroundColor: "var(--status-danger-bg)",
      }}
    >
      <h2
        className="text-sm font-medium"
        style={{ color: "var(--status-danger-fg)" }}
      >
        Danger zone
      </h2>
      <p
        className="mt-1 text-sm"
        style={{ color: "var(--status-danger-fg)" }}
      >
        Permanently delete your account and every trip, share, email link, and
        calendar link tied to it. This cannot be undone.
      </p>
      <Button
        variant="destructive"
        size="sm"
        disabled={busy || !accessToken}
        onClick={() => {
          void handleDelete();
        }}
        className="mt-3"
      >
        {busy ? "Deleting…" : "Delete account"}
      </Button>
    </section>
  );
}
