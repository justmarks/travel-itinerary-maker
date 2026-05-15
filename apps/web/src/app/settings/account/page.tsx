"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useAuth } from "@/lib/auth";
import { UserAvatar } from "@/components/user-avatar";
import { ConnectedProvidersPanel } from "@/components/connected-providers-panel";
import { ConnectedServicesPanel } from "@/components/connected-services-panel";
import { DeleteAccountSection } from "@/components/delete-account-section";
import { EmailScanSchedulesPanel } from "@/components/email-scan-schedules-panel";

export default function AccountSettingsPage(): React.JSX.Element {
  return (
    <RequireAuth>
      <AccountSettingsBody />
    </RequireAuth>
  );
}

function AccountSettingsBody(): React.JSX.Element | null {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to trips
      </Link>

      <h1 className="mb-6 text-2xl font-semibold">Account</h1>

      <section className="mb-8 flex items-center gap-4 rounded-md border border-border bg-card p-4">
        <UserAvatar
          picture={user.picture}
          name={user.name}
          email={user.email}
          size="md"
        />
        <div className="min-w-0">
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-sm text-muted-foreground">
            {user.email}
          </div>
        </div>
      </section>

      <ConnectedProvidersPanel />

      <div className="mt-10 border-t border-border pt-6">
        <ConnectedServicesPanel />
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <EmailScanSchedulesPanel />
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <DeleteAccountSection />
      </div>
    </main>
  );
}
