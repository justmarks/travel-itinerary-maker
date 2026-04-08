import SharedTripClient from "./shared-trip-client";

export function generateStaticParams() {
  // Pre-generate a placeholder page for static export.
  // Real shared tokens fall back to 404.html (which serves the same SPA shell).
  return [{ token: "_" }];
}

export default function SharedTripPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return <SharedTripClient params={params} />;
}
