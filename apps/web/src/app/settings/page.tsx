import { redirect } from "next/navigation";

/**
 * /settings is the natural address users / stale links target. Only
 * /settings/account exists today; redirect there so we don't 404.
 */
export default function SettingsIndex(): never {
  redirect("/settings/account");
}
