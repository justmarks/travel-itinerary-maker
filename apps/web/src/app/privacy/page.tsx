import type { Metadata } from "next";
import Link from "next/link";
import { AppLogo } from "@/components/app-logo";

export const metadata: Metadata = {
  title: "Privacy Policy — itinly",
  description: "How itinly handles your data.",
};

export default function PrivacyPage(): React.JSX.Element {
  return (
    <main className="min-h-screen px-4 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <AppLogo className="h-6 w-6" />
          <span className="font-semibold">itinly</span>
        </Link>

        <article className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground">
              Effective Date: May 1, 2026
            </p>
          </header>

          <section className="space-y-3">
            <p>
              itinly (&quot;the Service,&quot; &quot;we,&quot; or
              &quot;us&quot;) is a travel-itinerary application that turns trip
              confirmations from your Gmail inbox into a structured day-by-day
              itinerary. This policy explains what data we access, where it is
              stored, and the choices you have. By using the Service you agree
              to the practices described below.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">
              1. Google Account Data We Access
            </h2>
            <p>
              When you sign in with Google, the Service requests the following
              OAuth scopes. We ask for each one for a single, narrow purpose,
              and we do not use Google user data for advertising, model
              training, resale, or any purpose other than providing the
              Service&apos;s core features to you.
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Basic profile (openid, email, profile)</strong> — to
                identify your account, display your name and avatar inside the
                app, and contact you about the Service.
              </li>
              <li>
                <strong>Gmail read-only (gmail.readonly)</strong> — used only
                when you initiate an email scan. We search your inbox for
                messages that look like travel confirmations (flights, hotels,
                rentals, reservations) and read those messages so we can
                extract trip details. We do not read mail outside the queries
                you trigger, and we never send mail on your behalf.
              </li>
              <li>
                <strong>Drive per-file access (drive.file)</strong> — used to
                create and update files in a single app-managed folder
                (&quot;TravelItineraryMaker&quot;) inside <em>your</em> Google
                Drive. This scope only grants access to files the app itself
                creates; it does <em>not</em> grant the Service access to any
                other file in your Drive.
              </li>
              <li>
                <strong>Google Calendar (calendar)</strong> — used only when
                you choose to sync a trip to your calendar. We create or update
                events corresponding to your itinerary segments. We do not
                read or modify unrelated events.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">
              2. Where Your Data Is Stored
            </h2>
            <p>
              <strong>Your trip data lives in your own Google Drive.</strong>{" "}
              Itineraries, segments, todo lists, settings, and the metadata
              we keep about which emails you have already imported are written
              as JSON files inside the <code>TravelItineraryMaker</code> folder
              in your Drive. We do not maintain a separate copy of your trip
              data on our servers. If you delete that folder, your data is
              gone from the Service.
            </p>
            <p>
              <strong>Server-side data is limited to what is required to
              keep your session and shared links working.</strong> Specifically:
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Encrypted Google refresh tokens.</strong> When you
                sign in we store an encrypted refresh token so that recipients
                of share links you create can read the shared trip from your
                Drive even when you are offline. Refresh tokens are encrypted
                at rest with AES-256-GCM using a server-held key.
              </li>
              <li>
                <strong>A share registry.</strong> When you create a share
                link, we store a record mapping that link&apos;s opaque ID to
                the underlying trip so recipients can resolve the link.
              </li>
              <li>
                <strong>Operational logs and error reports.</strong> Our
                servers produce request logs and, when configured, send error
                reports to Sentry to help us diagnose crashes. These may
                contain your account ID, request paths, and error messages,
                but we make a best effort to avoid logging email contents or
                trip details.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">
              3. Email Parsing and Anthropic
            </h2>
            <p>
              When you trigger an email scan, the Service sends the contents
              of the candidate travel-confirmation messages it finds to
              Anthropic&apos;s Claude API for parsing into structured trip
              data. We do this only on emails identified as likely travel
              confirmations, and only at your request. Anthropic processes
              these requests under its own commercial API terms and does not
              use API inputs to train its models. The structured result is
              written to your Drive; the raw email is not stored on our
              servers.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">4. Third-Party Services</h2>
            <p>
              The Service relies on the following sub-processors. We share
              with them only what is necessary to operate the relevant
              feature.
            </p>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Google</strong> — authentication (Sign-In with
                Google), Drive storage, Gmail access, Calendar sync.
              </li>
              <li>
                <strong>Anthropic</strong> — email parsing via the Claude API
                (described above).
              </li>
              <li>
                <strong>Vercel</strong> — hosting of the web application.
              </li>
              <li>
                <strong>Upstash (Redis)</strong> — storage of encrypted
                refresh tokens and the share registry.
              </li>
              <li>
                <strong>Sentry</strong> — error reporting (when configured).
              </li>
            </ul>
            <p>
              We do not sell, rent, or trade your personal data, and we do
              not use it for advertising.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">5. Cookies and Tracking</h2>
            <p>
              The Service uses only the cookies and local-storage entries
              necessary to keep you signed in (for example, OAuth state and
              your access token). We do not use third-party advertising
              cookies or behavioral-tracking pixels.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">
              6. Your Rights and Choices
            </h2>
            <ul className="list-disc space-y-2 pl-6">
              <li>
                <strong>Revoke access at any time</strong> from your Google
                Account&apos;s &quot;Third-party apps with account
                access&quot; page (
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  myaccount.google.com/permissions
                </a>
                ). Revoking access invalidates the refresh token we hold for
                you.
              </li>
              <li>
                <strong>Delete your data</strong> by deleting the{" "}
                <code>TravelItineraryMaker</code> folder from your Google
                Drive. This removes all itineraries, segments, todos, and
                processed-email metadata.
              </li>
              <li>
                <strong>Request server-side deletion</strong> of your
                encrypted refresh token and share-registry entries by
                contacting us at the address below.
              </li>
              <li>
                <strong>Disconnect a single feature</strong> (for example,
                stop using calendar sync) by simply not invoking it; no data
                is sent to that feature&apos;s sub-processor unless you use
                it.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">7. Children</h2>
            <p>
              The Service is not directed to children under 13, and we do not
              knowingly collect personal information from them.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">8. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. The &quot;Effective
              Date&quot; at the top of this page reflects the most recent
              revision. Material changes will be announced in the application
              itself before they take effect.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">9. Contact</h2>
            <p>
              Questions, deletion requests, or concerns about this policy can
              be sent to{" "}
              <a
                href="mailto:support@itinly.app"
                className="underline underline-offset-4 hover:text-foreground"
              >
                support@itinly.app
              </a>
              .
            </p>
          </section>
        </article>

        <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          <Link href="/terms" className="underline underline-offset-4 hover:text-foreground">
            Terms of Service
          </Link>
        </footer>
      </div>
    </main>
  );
}
