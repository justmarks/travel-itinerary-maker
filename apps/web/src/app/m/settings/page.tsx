import { redirect } from "next/navigation";

export default function MobileSettingsIndex(): never {
  redirect("/m/settings/account");
}
