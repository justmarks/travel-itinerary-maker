import Link from "next/link";
import { AppLogo } from "@/components/app-logo";

export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
        <AppLogo className="h-10 w-10 opacity-80" />
        <div className="space-y-1">
          <p className="text-kicker font-semibold text-muted-foreground">
            404
          </p>
          <h1 className="text-xl font-semibold">We can&apos;t find that page</h1>
          <p className="text-sm text-muted-foreground">
            The link may be broken or the page may have moved.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Back to itinly
        </Link>
      </div>
    </main>
  );
}
