import type { Metadata } from "next";
import Link from "next/link";
import { AppLogo } from "@/components/app-logo";

export const metadata: Metadata = {
  title: "Terms of Service — itinly",
  description: "The terms governing use of itinly.",
};

export default function TermsPage(): React.JSX.Element {
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
            <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
            <p className="text-sm text-muted-foreground">
              Effective Date: May 13, 2026
            </p>
          </header>

          <section className="space-y-3">
            <p>
              These Terms of Service (&quot;Terms&quot;) govern your access to
              and use of itinly (&quot;the Service,&quot; &quot;we,&quot; or
              &quot;us&quot;), a travel-itinerary application that turns
              trip-confirmation emails from your Gmail or Outlook inbox into
              structured itineraries you can view, edit, share, and sync to
              your calendar. By signing in or otherwise using the Service,
              you agree to these Terms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">1. Eligibility</h2>
            <p>
              You must be at least 13 years old, have a valid Google or
              Microsoft account, and be permitted to enter into a binding
              agreement under the laws of your jurisdiction. By using the
              Service you represent that you meet these requirements.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">2. The Service</h2>
            <p>
              The Service reads travel-confirmation emails you ask it to
              scan, parses them into itinerary data, and stores that data
              in itinly&apos;s managed database under your account. You
              may also choose to sync itineraries to Google Calendar or
              Outlook Calendar, or share an itinerary with another person
              via a share link. A single itinly account can hold one
              Google identity and one Microsoft identity at the same
              time, plus separate Mail and Calendar capability
              connections per provider; you can manage and disconnect
              these from <code>/settings/account</code> inside the app.
              Detailed data practices are described in our{" "}
              <Link
                href="/privacy"
                className="underline underline-offset-4 hover:opacity-80"
              >
                Privacy Policy
              </Link>
              , which is incorporated by reference into these Terms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">3. Your Account and Data</h2>
            <p>
              You are responsible for safeguarding your Google and/or
              Microsoft account credentials and for all activity that
              occurs under your access to the Service. Your trip data is
              stored in itinly&apos;s managed database under your
              account. You can manage linked identities and per-provider
              integrations at <code>/settings/account</code>, revoke the
              Service&apos;s access from your Google account at{" "}
              <a
                href="https://myaccount.google.com/permissions"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 hover:opacity-80"
              >
                myaccount.google.com/permissions
              </a>{" "}
              (or the equivalent page in your Microsoft account), and
              request deletion of your stored trip data by contacting
              support at the address in Section 11.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">4. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                use the Service to access, scan, or share data belonging to
                another person without their authorization;
              </li>
              <li>
                attempt to probe, attack, or disrupt the Service or its
                infrastructure, or to reverse-engineer it for the purpose of
                doing so;
              </li>
              <li>
                use the Service in violation of applicable law or any
                third-party rights;
              </li>
              <li>
                use the Service in a manner inconsistent with{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:opacity-80"
                >
                  Google&apos;s API Services User Data Policy
                </a>
                , including its Limited Use requirements; or
              </li>
              <li>
                use automated means to extract data from the Service in a way
                that imposes an unreasonable load.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">5. Intellectual Property</h2>
            <p>
              The itinly source code is published under the MIT License. The
              name, logo, and brand assets remain our property. You retain
              all rights to the trip data and other content you create or
              import while using the Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">6. Third-Party Services</h2>
            <p>
              The Service depends on third-party providers, including
              Google, Microsoft, Supabase, Anthropic, Vercel, Upstash, and
              Sentry. Their respective terms and privacy policies apply to
              your use of their portions of the Service. We are not
              responsible for the availability or conduct of these third
              parties.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">7. Disclaimer of Warranty</h2>
            <p>
              THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS
              AVAILABLE,&quot; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS
              OR IMPLIED, INCLUDING THE IMPLIED WARRANTIES OF MERCHANTABILITY,
              FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. We do
              not warrant that parsed itinerary data will be accurate or
              complete; you remain responsible for verifying flight times,
              reservations, and other travel details before relying on them.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">
              8. Limitation of Liability
            </h2>
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL THE
              SERVICE&apos;S OPERATORS BE LIABLE FOR ANY INDIRECT,
              INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY
              LOSS OF PROFITS OR DATA, ARISING OUT OF OR RELATED TO YOUR USE
              OF THE SERVICE, WHETHER BASED IN CONTRACT, TORT, OR ANY OTHER
              LEGAL THEORY, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY
              OF SUCH DAMAGES.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">9. Termination</h2>
            <p>
              You may stop using the Service at any time and revoke its
              access to your Google or Microsoft account. We may suspend
              or terminate access to the Service at our discretion,
              particularly in response to violations of these Terms or to
              protect the security of the Service or its users.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">10. Changes to These Terms</h2>
            <p>
              We may update these Terms from time to time. The &quot;Effective
              Date&quot; at the top of this page reflects the most recent
              revision. Continued use of the Service after a change
              constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-xl font-semibold">11. Contact</h2>
            <p>
              Questions about these Terms can be sent to{" "}
              <a
                href="mailto:support@itinly.app"
                className="underline underline-offset-4 hover:opacity-80"
              >
                support@itinly.app
              </a>
              .
            </p>
          </section>
        </article>

        <footer className="mt-12 border-t pt-6 text-sm text-muted-foreground">
          <Link href="/privacy" className="underline underline-offset-4 hover:opacity-80">
            Privacy Policy
          </Link>
        </footer>
      </div>
    </main>
  );
}
