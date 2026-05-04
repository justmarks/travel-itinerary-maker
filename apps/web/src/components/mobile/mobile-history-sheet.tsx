"use client";

import type { TripHistoryEntry } from "@travel-app/shared";
import { MobileBottomSheet } from "./mobile-bottom-sheet";
import { TripHistory } from "@/components/trip-history";

interface MobileHistorySheetProps {
  entries: TripHistoryEntry[] | undefined;
  open: boolean;
  onClose: () => void;
}

export function MobileHistorySheet({
  entries,
  open,
  onClose,
}: MobileHistorySheetProps): React.JSX.Element {
  const count = entries?.length ?? 0;
  return (
    <MobileBottomSheet open={open} onClose={onClose} ariaLabel="Trip history">
      <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-1">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            History
          </p>
          <h2 className="mt-0.5 text-2xl font-bold leading-tight">
            {count}
            <span className="ml-2 text-base font-medium text-muted-foreground">
              {count === 1 ? "change" : "changes"}
            </span>
          </h2>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <TripHistory entries={entries} />
      </div>
    </MobileBottomSheet>
  );
}
