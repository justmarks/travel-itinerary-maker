import { redirect } from "next/navigation";

/**
 * /m/settings was unrouted, so any visitor (or stale link) landed on
 * Next.js's bare 404. Account is the only settings page that exists
 * on mobile today, so bounce there.
 */
export default function MobileSettingsIndex(): never {
  redirect("/m/settings/account");
}
