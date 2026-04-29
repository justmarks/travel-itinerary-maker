"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Drag-down past this distance (px) closes the sheet. */
const DISMISS_THRESHOLD_PX = 100;
/** Drag-up past this distance (px) snaps the sheet to its expanded height. */
const EXPAND_THRESHOLD_PX = 60;

/**
 * Generic bottom sheet for the mobile experience. Behaviour:
 *
 * - Renders a backdrop covering the viewport (click to close) and a
 *   `fixed`-positioned sheet anchored to the viewport bottom, capped at
 *   the MobileFrame width on desktop.
 * - The drag handle (a 24px tap zone around the visible pill) supports
 *   pointer-driven gestures:
 *     · Drag down past 100px → close
 *     · Drag up past 60px → snap to expanded (95dvh) height
 *     · Drag down past 100px from expanded → snap back to default
 * - Snapshots the sheet's current height on pointer-down so upward drag
 *   tracks the finger 1:1 instead of jumping to a baseline.
 * - Locks body scroll while open and closes on Escape.
 *
 * The body of the sheet is whatever consumers pass as children. Headers,
 * footers, and scroll regions are the consumer's responsibility — this
 * component only owns the chrome (frame, backdrop, drag handle).
 */
export function MobileBottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}): React.JSX.Element | null {
  const [expanded, setExpanded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragStartY = useRef<number | null>(null);
  const [dragStartHeight, setDragStartHeight] = useState<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const isDragging = dragStartY.current !== null;

  // Close on Escape so desktop testing isn't a trap.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Reset drag + expanded state every time the sheet opens so each open
  // starts from the default snap point.
  useEffect(() => {
    if (!open) return;
    setExpanded(false);
    setDragY(0);
    setDragStartHeight(null);
    dragStartY.current = null;
  }, [open]);

  // Lock background scroll while the sheet is up so the page behind doesn't
  // drift behind the backdrop.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStartY.current = e.clientY;
    setDragStartHeight(sheetRef.current?.offsetHeight ?? null);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    setDragY(e.clientY - dragStartY.current);
  };

  const handlePointerUp = () => {
    if (dragStartY.current === null) return;
    const offset = dragY;
    dragStartY.current = null;
    setDragStartHeight(null);

    if (offset > DISMISS_THRESHOLD_PX) {
      if (expanded) {
        setExpanded(false);
        setDragY(0);
      } else {
        setDragY(0);
        onClose();
      }
      return;
    }

    if (!expanded && offset < -EXPAND_THRESHOLD_PX) {
      setExpanded(true);
      setDragY(0);
      return;
    }

    setDragY(0);
  };

  if (!open) return null;

  const downTranslatePx = Math.max(0, dragY);
  const upGrowthPx = Math.max(0, -dragY);

  let sheetStyle: React.CSSProperties;
  if (isDragging && upGrowthPx > 0 && dragStartHeight !== null) {
    sheetStyle = {
      height: `min(95dvh, ${dragStartHeight + upGrowthPx}px)`,
      transform: "translate(-50%, 0px)",
    };
  } else if (expanded) {
    sheetStyle = {
      height: "95dvh",
      transform: `translate(-50%, ${downTranslatePx}px)`,
    };
  } else {
    sheetStyle = {
      maxHeight: "85dvh",
      transform: `translate(-50%, ${downTranslatePx}px)`,
    };
  }

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div
        ref={sheetRef}
        className={cn(
          "fixed bottom-0 left-1/2 flex w-full max-w-[430px] flex-col",
          "rounded-t-3xl bg-background shadow-2xl",
          !isDragging &&
            "transition-[height,max-height,transform] duration-200 ease-out",
        )}
        style={sheetStyle}
      >
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex shrink-0 cursor-grab touch-none justify-center py-3 active:cursor-grabbing"
        >
          <div className="h-1 w-10 rounded-full bg-muted-foreground/40" />
        </div>

        {children}
      </div>
    </div>
  );
}
