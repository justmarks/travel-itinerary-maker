"use client";

import { Suspense, useState } from "react";
import { CreateTripDialog } from "@/components/create-trip-dialog";
import { EmailScanDialog } from "@/components/email-scan-dialog";
import { HtmlImportDialog } from "@/components/html-import-dialog";
import { XlsxImportDialog } from "@/components/xlsx-import-dialog";
import { TripList } from "@/components/trip-list";
import { RequireAuth } from "@/components/require-auth";
import { UserMenu } from "@/components/user-menu";
import { AppLogo } from "@/components/app-logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FileCode2,
  FileSpreadsheet,
  MoreHorizontal,
} from "lucide-react";
import { useMobileHomeRedirect } from "@/lib/mobile-redirect";

function MobileRedirect(): null {
  useMobileHomeRedirect();
  return null;
}

export default function Home(): React.JSX.Element {
  const [htmlImportOpen, setHtmlImportOpen] = useState(false);
  const [xlsxImportOpen, setXlsxImportOpen] = useState(false);

  return (
    <RequireAuth redirectTo="/welcome">
      <Suspense fallback={null}>
        <MobileRedirect />
      </Suspense>
      <main className="min-h-screen p-4 sm:p-8">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <AppLogo className="h-8 w-8 shrink-0" />
              <h1 className="truncate text-2xl font-bold">My Trips</h1>
            </div>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <EmailScanDialog triggerSize="default" />
              <CreateTripDialog />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="More actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setHtmlImportOpen(true)}>
                    <FileCode2 className="mr-2 h-4 w-4" />
                    Import email
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setXlsxImportOpen(true)}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Import XLSX
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <HtmlImportDialog
                hideTrigger
                open={htmlImportOpen}
                onOpenChange={setHtmlImportOpen}
              />
              <XlsxImportDialog
                hideTrigger
                open={xlsxImportOpen}
                onOpenChange={setXlsxImportOpen}
              />
              <UserMenu />
            </div>
          </div>
          <TripList />
        </div>
      </main>
    </RequireAuth>
  );
}
