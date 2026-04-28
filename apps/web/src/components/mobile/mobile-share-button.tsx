"use client";

import { useCallback, useState } from "react";
import { Check, Share2 } from "lucide-react";

/**
 * Native-share button for the mobile trip header. On supported browsers
 * (most mobile, iOS PWA), invokes the OS share sheet via `navigator.share`.
 * Falls back to copy-to-clipboard with a brief "Copied" confirmation when
 * Web Share isn't available (most desktop browsers, Firefox Android).
 *
 * Note: this shares the *current page URL*, which only works for recipients
 * who can authenticate or for demo links. Real public-share-token URLs come
 * in Phase 2 alongside share-link consumption (`/m/shared`).
 */
export function MobileShareButton({
  title,
  text,
}: {
  title: string;
  text?: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const payload = { title, text, url };

    if (typeof navigator.share === "function") {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        // AbortError = user dismissed the share sheet; nothing to do.
        if (err instanceof Error && err.name === "AbortError") return;
        // Fall through to clipboard on other errors.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard refused (insecure context, permissions). Silent — the
      // button is non-essential.
    }
  }, [title, text]);

  return (
    <button
      type="button"
      onClick={handleShare}
      aria-label={copied ? "Link copied" : "Share trip"}
      className="flex h-9 w-9 items-center justify-center rounded-full text-foreground/80 hover:bg-muted active:bg-muted/80"
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-600" />
      ) : (
        <Share2 className="h-4 w-4" />
      )}
    </button>
  );
}
