# Supabase Auth setup (Phase 3)

One-time configuration the Phase 3 backend depends on. Pair with the
code changes in `claude/backend-migration-phase-3` (Supabase JWT
validation, `connections` table, `/api/v1/connections` endpoints).

## Prerequisites

- A Supabase project (free tier is fine; create at supabase.com if you
  don't already have one)
- Access to the existing Google Cloud Console OAuth client itinly uses
- Azure account for the Microsoft provider (free tier; Microsoft account
  works)

---

## 1. Supabase: Site URL + Redirect URLs

In the Supabase Dashboard:

`Authentication → URL Configuration`

**Site URL** — the canonical post-signin redirect target. Pick one:
- Local dev: `http://localhost:3000`
- Production: `https://itinly.app` (or your real prod domain)

**Redirect URLs** (allowlist; sign-ins from each are allowed):

```
http://localhost:3000/auth/callback
http://localhost:3000/**
https://itinly-git-*-justmarks-projects.vercel.app/auth/callback
https://itinly-git-*-justmarks-projects.vercel.app/**
https://itinly.app/auth/callback
https://itinly.app/**
```

The `/**` wildcards cover sub-paths. The Vercel wildcard matches
every per-PR preview deployment.

## 2. Supabase: Google provider

`Authentication → Providers → Google → Enable`

- **Client ID** + **Client Secret**: from your existing Google Cloud
  Console OAuth 2.0 client (the same one the legacy flow uses)
- Note the callback URL Supabase shows:
  `https://<your-project-ref>.supabase.co/auth/v1/callback`

Then go back to **Google Cloud Console → Credentials → your OAuth
client** and **add** that callback URL to "Authorized redirect URIs".
Keep your existing redirect URIs in place so the legacy flow keeps
working during the coexistence window.

## 3. Azure AD: app registration for Microsoft

Microsoft sign-in requires an Azure AD app registration. The Supabase
side just points at it.

[portal.azure.com](https://portal.azure.com) → **Azure Active Directory
→ App registrations → New registration**

1. **Name**: `itinly auth` (or anything)
2. **Supported account types**: "Accounts in any organizational
   directory and personal Microsoft accounts". This allows both
   work / school accounts (Azure AD) and personal accounts
   (`@outlook.com`, `@hotmail.com`, `@live.com`).
3. **Redirect URI**:
   - Platform: **Web**
   - URI: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`

After registration:

4. Copy the **Application (client) ID** from the Overview page —
   this is the Microsoft Client ID for Supabase.

5. **Certificates & secrets → New client secret**:
   - Description: anything (e.g. `supabase-prod`)
   - Expires: 24 months
   - Click Add, then **copy the Value** (only shown once). This is
     the Microsoft Client Secret for Supabase.

6. **API permissions → Add permission → Microsoft Graph → Delegated
   permissions**:
   - `openid` — sign-in
   - `email` — user's email
   - `profile` — basic profile
   - `offline_access` — required to get refresh tokens
   - `User.Read` — read user profile
   - (Phase 4 will add `Mail.Read` and `Calendars.ReadWrite` for the
     Outlook email + calendar connectors. Defer those until needed.)
7. Click **Grant admin consent for [your tenant]** if you have admin
   rights — required for some org accounts.

## 4. Supabase: Microsoft (Azure) provider

`Authentication → Providers → Azure → Enable`

- **Client ID**: the Application (client) ID from step 3.4
- **Client Secret**: the secret Value from step 3.5
- **Microsoft Tenant URL**:
  ```
  https://login.microsoftonline.com/common/v2.0
  ```
  `common` accepts all Microsoft account types — matches the
  "Accounts in any organizational directory and personal Microsoft
  accounts" choice from the Azure app registration. The alternatives
  (`organizations` for work-only, `consumers` for personal-only,
  `<tenant-id>` for one-org-only) only fit narrower use cases.

## 5. Supabase: enable manual identity linking

`Authentication → User Management → Account Linking → Manual linking: enabled`

This unlocks `supabase.auth.linkIdentity()` on the frontend, which the
Phase 3b account-merge flow uses ("you already have an account with
Google; link Microsoft too?"). Backend-side, no code change needed —
both identities resolve to the same `auth.users` row in Supabase.

## 6. Env vars

Copy these from **Project Settings → API** in the Supabase dashboard.

**`server/.env` (and Railway prod):**

```
SUPABASE_URL=https://<your-project-ref>.supabase.co
```

That's all the server needs. The JWKS endpoint is derived from the
URL; the JWT signing key comes from there. We do not need
`SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY` on the server —
those are for client-side or admin-level operations.

**`apps/web/.env.local` (Phase 3b frontend wiring — now live):**

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key from Settings → API>
```

The frontend uses these via `@supabase/supabase-js` to perform the
OAuth dance. When **both** vars are present in the build:
- `/login` and `/m/login` render Google **and** Microsoft buttons; both
  route through `supabase.auth.signInWithOAuth(...)`.
- `/auth/callback` recognises Supabase sessions (in addition to the
  legacy custom Google flow it already handled) and POSTs an
  identity connection row to `/api/v1/connections` on first sign-in.

When either var is **missing** in the build:
- The Microsoft button is hidden entirely.
- The Google button falls back to the legacy custom OAuth flow.
- Existing signed-in users on legacy tokens are unaffected.

On Vercel set both vars under **Project Settings → Environment Variables**
for the **Preview** and **Production** scopes. The deletion PR (which
removes the legacy flow) will turn the missing-env case into a
build-time failure, mirroring the `NEXT_PUBLIC_API_URL` guard in
`next.config.ts`.

## What's safe to do when

| Step | Safe to do | Effect |
|---|---|---|
| Site URL + Redirect URLs | Anytime | None until frontend uses Supabase Auth |
| Google provider config in Supabase + add callback to GCloud | Anytime | Legacy flow keeps working |
| Azure app registration + Microsoft provider in Supabase | Anytime | Inert until frontend uses Supabase Auth |
| Manual linking: enabled | Anytime | Inert until frontend uses linkIdentity |
| Set `SUPABASE_URL` on server | After Phase 3 PR lands | `requireAuth` starts accepting Supabase JWTs |
| Set `NEXT_PUBLIC_SUPABASE_*` on web | After Phase 3b PR lands | Login pages route through Supabase; Microsoft button appears |

## Verifying the setup

After Phase 3 PR is on `preview` and `SUPABASE_URL` is set in Railway:

1. Hit the Railway preview API root `/`: should respond with the
   usual JSON. (No regression for unauthenticated traffic.)
2. Sign in via the legacy flow on the web app (still works because
   the frontend hasn't moved yet). Expect: a working session,
   `req.authSource = "google-legacy"`, no `connections` row written.
3. Once Phase 3b ships the frontend, sign in via Supabase Auth →
   Google. Expect: a Supabase JWT, `req.authSource = "supabase"`, a
   `connections` row created via `POST /api/v1/connections`.

## Troubleshooting

**"Invalid login URL" from Supabase after sign-in.**
Site URL or the relevant Redirect URL isn't in the allowlist.
Double-check the trailing slash, wildcards, and that the URL you're
running on matches.

**"AADSTS700051" or "AADSTS50011" from Microsoft.**
The Azure app registration's redirect URI doesn't include
`https://<supabase-project>.supabase.co/auth/v1/callback`. Add it
under Authentication → Web → Redirect URIs.

**"invalid_grant" from Google.**
The Google OAuth client doesn't include
`https://<supabase-project>.supabase.co/auth/v1/callback` in its
Authorized redirect URIs.

**Empty `provider_refresh_token` on the Supabase session.**
You're missing `offline_access` (Microsoft) or `access_type=offline`
(Google). Supabase requests them by default for these providers, but
if you tweak `additionalScopes` make sure not to clobber them.

**"Bearer token expired" on every request after a refresh.**
Supabase access tokens have a short TTL (default 1 hour). The
frontend (`@supabase/supabase-js`) auto-refreshes; Phase 3b will wire
this up. Pre-Phase-3b clients keep using legacy Google tokens, which
follow Google's own expiry semantics.
