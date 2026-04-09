import TripDetailClient from "./trip-detail-client";

export function generateStaticParams() {
  // Pre-generate demo trip pages for static export.
  // In dev mode, Next.js also allows any tripId not in this list.
  // In production (static export), unknown IDs fall back to 404.html.
  return [{ tripId: "demo-1" }, { tripId: "demo-2" }, { tripId: "demo-3" }];
}

export default function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  return <TripDetailClient params={params} />;
}
