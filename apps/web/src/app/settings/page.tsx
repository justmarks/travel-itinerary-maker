import { redirect } from "next/navigation";

export default function SettingsIndex(): never {
  // /settings is the obvious guess for the account-management surface,
  // but the only page under it is /settings/account. Redirect to the
  // canonical URL instead of letting Next fall through to the bare 404.
  redirect("/settings/account");
}
