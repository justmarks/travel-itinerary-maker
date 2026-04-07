import TripDetailClient from "./trip-detail-client";

export function generateStaticParams() {
  // Pre-generate demo trip pages for static export.
  // Newly created trips fall back to 404.html (which serves the same SPA shell).
  return [{ tripId: "demo-1" }, { tripId: "demo-2" }];
}

export default function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  return <TripDetailClient params={params} />;
}
