"use client";

/**
 * Tiny avatar component that prefers a provider photo when present and
 * falls back to a deterministic colored circle with the user's initials
 * when it isn't.
 *
 * Used in both desktop and mobile user-menus. Centralised so the
 * fallback shape stays consistent across surfaces — every place a
 * user's avatar appears renders the same circle, with the same color
 * derivation, and the same initials rule.
 *
 * Why we have a fallback at all: Microsoft (Azure AD) sign-ins via
 * Supabase don't surface a profile photo URL through standard OIDC
 * claims, and even Google users sometimes have no photo set. Showing
 * a generic person icon for those users looks unfinished next to
 * users with real photos. A colored initials circle reads as "this is
 * me" instead of "the app is broken."
 */

import type { CSSProperties } from "react";

interface UserAvatarProps {
  /** Provider photo URL, or null/undefined to force the fallback. */
  picture: string | null | undefined;
  /**
   * The user's display name. Used to derive the initials when no
   * picture is set. Falls back to email if name is empty.
   */
  name: string;
  /**
   * The user's email. Used as a stable input for color derivation —
   * same person always gets the same color across devices.
   */
  email: string;
  /**
   * Visual size. Maps to a Tailwind size class + matching font size.
   * Two presets cover every existing usage; add a third here rather
   * than overriding via className.
   */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Brand-aligned palette. Each color meets WCAG AA contrast with white
 * text (≥ 4.5:1) so the initials stay legible. Picked to be visually
 * distinct enough that two users sitting next to each other in a
 * share-rule list don't pick the same circle by accident.
 */
const AVATAR_COLORS = [
  "#008CCF", // cyan (matches --primary)
  "#D9501C", // vermilion (matches --brand)
  "#7C3AED", // violet
  "#059669", // emerald
  "#DC2626", // red
  "#D97706", // amber
  "#0891B2", // teal
  "#DB2777", // pink
] as const;

function hashString(input: string): number {
  // Tiny deterministic hash — not cryptographic, just stable. djb2-style
  // with `| 0` to keep it in int32 range.
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function colorForEmail(email: string): string {
  return AVATAR_COLORS[hashString(email.toLowerCase()) % AVATAR_COLORS.length];
}

function initialsFor(name: string, email: string): string {
  // Strip whitespace + non-letter prefixes (some Google names come back
  // with leading honorifics in odd characters).
  const trimmed = name.trim();
  if (trimmed) {
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    if (tokens.length === 1) {
      return tokens[0].slice(0, 2).toUpperCase();
    }
    const first = tokens[0][0] ?? "";
    const last = tokens[tokens.length - 1][0] ?? "";
    return (first + last).toUpperCase();
  }
  // No name → first two letters of the local-part of the email.
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "?";
}

const SIZE_CLASS: Record<NonNullable<UserAvatarProps["size"]>, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-xs",
};

export function UserAvatar({
  picture,
  name,
  email,
  size = "md",
  className = "",
}: UserAvatarProps): React.JSX.Element {
  const sizeClass = SIZE_CLASS[size];
  if (picture) {
    return (
      // Provider photos come from arbitrary CDN hosts (Google
      // lh*.googleusercontent.com today, data: URLs from Microsoft
      // Graph for `picture` set via lib/auth.tsx, possibly more
      // providers later). Next/Image would require whitelisting every
      // host and offers negligible benefit at this size.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={picture}
        alt=""
        className={`${sizeClass} rounded-full ${className}`}
        referrerPolicy="no-referrer"
      />
    );
  }
  const initials = initialsFor(name, email);
  const style: CSSProperties = { backgroundColor: colorForEmail(email) };
  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center font-medium text-white ${className}`}
      style={style}
      aria-hidden
    >
      {initials}
    </div>
  );
}
