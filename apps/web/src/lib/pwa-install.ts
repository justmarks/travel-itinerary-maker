"use client";

import { useEffect, useState } from "react";

/**
 * The Chrome `beforeinstallprompt` event isn't standardised yet, so we
 * declare the shape we care about locally rather than pulling in a global
 * `Window` augmentation.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type InstallState = {
  /** True while the browser has a deferred prompt we can fire. */
  canInstall: boolean;
  /** True once the app is running as an installed PWA (display-mode: standalone). */
  isInstalled: boolean;
  /** Trigger the native install prompt. Returns whether the user accepted. */
  promptInstall: () => Promise<boolean>;
};

/**
 * iOS Safari never fires `beforeinstallprompt` — installing requires the
 * Share → Add to Home Screen flow. We surface this so callers can show an
 * iOS-specific instruction instead of hiding the option.
 */
export function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/.test(ua);
  // Safari (incl. iOS) has Safari/ in UA but excludes Chrome/CriOS/FxiOS.
  const isSafari =
    /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  return isIos && isSafari;
}

function detectInstalled(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari sets this non-standard flag when launched from the home
  // screen.
  return Boolean(
    (window.navigator as { standalone?: boolean }).standalone,
  );
}

export function usePwaInstall(): InstallState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    setIsInstalled(detectInstalled());

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setDeferred(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    return choice.outcome === "accepted";
  };

  return {
    canInstall: deferred !== null && !isInstalled,
    isInstalled,
    promptInstall,
  };
}
