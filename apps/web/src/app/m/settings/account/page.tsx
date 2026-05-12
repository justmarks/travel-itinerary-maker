"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RequireAuth } from "@/components/require-auth";
import { useAuth } from "@/lib/auth";
import { MobileFrame } from "@/components/mobile/mobile-shell";
import { UserAvatar } from "@/components/user-avatar";
import { ConnectedProvidersPanel } from "@/components/connected-providers-panel";
import { ConnectedServicesPanel } from "@/components/connected-services-panel";

export default function MobileAccountSettingsPage(): React.JSX.Element {
  return (
    <RequireAuth>
      <MobileFrame>
        <MobileAccountSettingsBody />
      </MobileFrame>
    </RequireAuth>
  );
}

function MobileAccountSettingsBody(): React.JSX.Element | null {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/85 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <Link
          href="/m"
          aria-label="Back"
          className="rounded p-1 hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-base font-semibold">Account</h1>
      </header>

      <div className="flex-1 px-4 py-6">
        <section className="mb-6 flex items-center gap-4 rounded-md border border-border bg-card p-4">
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

        <div className="mt-8 border-t border-border pt-6">
          <ConnectedServicesPanel />
        </div>
      </div>
    </div>
  );
}
