import { redirect } from "next/navigation";

export default function MobileSettingsIndex(): never {
  // Mobile equivalent of /settings → /settings/account. /m/settings
  // is the obvious guess for the account-management surface, but the
  // only page under it is /m/settings/account.
  redirect("/m/settings/account");
}
