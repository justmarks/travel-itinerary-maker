import { redirect } from "next/navigation";

export default function MobileTripsRedirect(): never {
  // Mobile uses `/m` as the trip list and `/m/trip` (singular) for an
  // individual trip — `/m/trips` is a natural guess that should land
  // the user on the list instead of 404ing.
  redirect("/m");
}
