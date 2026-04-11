"use client";

import { CreateTripDialog } from "@/components/create-trip-dialog";
import { EmailScanDialog } from "@/components/email-scan-dialog";
import { HtmlImportDialog } from "@/components/html-import-dialog";
import { XlsxImportDialog } from "@/components/xlsx-import-dialog";
import { TripList } from "@/components/trip-list";
import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { Plane } from "lucide-react";

export default function Home() {
  return (
    <RequireAuth>
      <main className="min-h-screen p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Plane className="h-7 w-7" />
              <h1 className="text-2xl font-bold">My Trips</h1>
            </div>
            <div className="flex items-center gap-2">
              <EmailScanDialog />
              <HtmlImportDialog />
              <XlsxImportDialog />
              <CreateTripDialog />
              <UserMenu />
            </div>
          </div>
          <TripList />
        </div>
      </main>
    </RequireAuth>
  );
}
