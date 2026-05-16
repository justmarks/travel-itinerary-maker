import { redirect } from "next/navigation";

export default function MobileSettingsPage(): never {
  redirect("/m/settings/account");
}
