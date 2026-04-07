import TripDetailClient from "./trip-detail-client";

export function generateStaticParams() {
  return [];
}

export default function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  return <TripDetailClient params={params} />;
}
