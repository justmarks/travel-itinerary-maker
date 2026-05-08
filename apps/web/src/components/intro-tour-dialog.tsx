"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Mail,
  MapPin,
  Share2,
  Smartphone,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useDemoMode } from "@/lib/demo";
import { useHintActive } from "@/lib/onboarding-hints";
import { isIosSafari, usePwaInstall } from "@/lib/pwa-install";

/**
 * Matches the breakpoint used by `useMobileHomeRedirect` so the install
 * step shows on the same viewports that get bumped to /m. Anything wider
 * than this lands on the desktop shell where the install affordance is
 * deliberately absent.
 */
const MOBILE_BREAKPOINT_PX = 767;

type TourStep = {
  key: "manage" | "email" | "share" | "install";
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
};

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isMobile;
}

/**
 * One-shot welcome tour shown the first time an authenticated user
 * lands on the app on a given device. Walks through the four core
 * features (manage trips, build from email, share, install) and
 * persists dismissal to localStorage so it never reappears on this
 * device. The install step is omitted entirely on desktop viewports.
 *
 * Mounted at the root of `Providers` so it works on both `/` and `/m`
 * without each shell having to opt in.
 */
export function IntroTourDialog(): React.JSX.Element | null {
  const { isAuthenticated, isLoading } = useAuth();
  const isDemo = useDemoMode();
  const { active, dismiss } = useHintActive("intro-tour");
  const isMobile = useIsMobileViewport();
  const { canInstall, isInstalled, promptInstall } = usePwaInstall();
  const [iosSafari, setIosSafari] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setIosSafari(isIosSafari());
  }, []);

  // Open the dialog once the auth state has settled. Demo mode skips
  // the tour — demo visitors are exploring sample data, not onboarding.
  useEffect(() => {
    if (isLoading) return;
    if (isDemo) return;
    if (!isAuthenticated) return;
    if (!active) return;
    setOpen(true);
  }, [isAuthenticated, isLoading, isDemo, active]);

  const steps = useMemo<TourStep[]>(() => {
    const base: TourStep[] = [
      {
        key: "manage",
        icon: MapPin,
        title: "Plan trips day by day",
        body: (
          <>
            Build itineraries with flights, hotels, meals, and activities —
            all laid out on a clean day-by-day timeline. Create one from
            scratch or import a booking and itinly fills in the details.
          </>
        ),
      },
      {
        key: "email",
        icon: Mail,
        title: "Build trips from your inbox",
        body: (
          <>
            Connect Gmail and itinly scans for booking confirmations —
            flights, hotels, reservations — and turns them into a
            structured trip. New emails keep your itineraries up to date
            automatically.
          </>
        ),
      },
      {
        key: "share",
        icon: Share2,
        title: "Share with travel companions",
        body: (
          <>
            Send a read-only link to anyone — partners, family, kids. They
            get a phone-friendly view of the itinerary, no sign-in needed,
            and updates flow through in real time.
          </>
        ),
      },
    ];
    if (isMobile && !isInstalled) {
      base.push({
        key: "install",
        icon: Smartphone,
        title: "Install itinly on your phone",
        body: iosSafari ? (
          <>
            Tap the <span className="font-medium">Share</span> icon in
            Safari, then{" "}
            <span className="font-medium">Add to Home Screen</span> to use
            itinly like a native app — works offline, fewer taps.
          </>
        ) : (
          <>
            Add itinly to your home screen to use it like a native app.
            Works offline, opens faster, and skips the browser chrome.
          </>
        ),
      });
    }
    return base;
  }, [isMobile, isInstalled, iosSafari]);

  // If the visible step list shrinks (e.g. install completes mid-tour),
  // clamp the cursor so we don't index out of bounds.
  useEffect(() => {
    if (stepIndex > steps.length - 1) {
      setStepIndex(Math.max(0, steps.length - 1));
    }
  }, [stepIndex, steps.length]);

  const handleClose = () => {
    setOpen(false);
    dismiss();
  };

  const handleInstall = async () => {
    const accepted = await promptInstall();
    if (accepted) {
      handleClose();
    }
  };

  const step = steps[stepIndex];
  if (!step) return null;
  const Icon = step.icon;
  const isLast = stepIndex === steps.length - 1;
  const isInstallStep = step.key === "install";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <div
            className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full sm:mx-0"
            style={{
              backgroundColor: "var(--status-info-bg)",
              color: "var(--status-info-fg)",
            }}
            aria-hidden
          >
            <Icon className="h-6 w-6" />
          </div>
          <DialogTitle>{step.title}</DialogTitle>
          <DialogDescription>{step.body}</DialogDescription>
        </DialogHeader>

        <div
          className="flex items-center justify-center gap-1.5 pt-1"
          aria-hidden
        >
          {steps.map((s, i) => (
            <span
              key={s.key}
              className={`h-1.5 rounded-full transition-all ${
                i === stepIndex ? "w-6 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>

        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClose}
          >
            Skip tour
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            {stepIndex > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
              >
                Back
              </Button>
            )}
            {isLast ? (
              isInstallStep && canInstall ? (
                <Button type="button" onClick={handleInstall}>
                  <Download className="mr-2 h-4 w-4" />
                  Install
                </Button>
              ) : (
                <Button type="button" onClick={handleClose}>
                  {isInstallStep ? "Got it" : "Get started"}
                </Button>
              )
            ) : (
              <Button
                type="button"
                onClick={() =>
                  setStepIndex((i) => Math.min(steps.length - 1, i + 1))
                }
              >
                Next
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
