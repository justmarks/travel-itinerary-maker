# Deprecated

This Expo / React Native scaffold is **no longer the active mobile target**.

The mobile experience is being built as a Progressive Web App (PWA) inside
`apps/web` under the `/m` route. That decision was made after evaluating
the tradeoff between maintaining two codebases vs. shipping a single
responsive web app that can be installed to a phone's home screen.

This package is kept on disk (rather than deleted) for two reasons:

1. The Google OAuth wiring in `src/auth/google.ts` and the API client in
   `src/api/client.ts` are useful references if we ever wrap the PWA in
   a native shell (Capacitor, or an Expo + WebView container) to access
   features the web platform can't reach — push notifications, biometric
   unlock, deep file system, etc.
2. Reverting this decision is cheaper if the package is still here.

## Status

- **CI**: do not run tests or builds for this package.
- **Development**: do not add new features here. Open issues and PRs
  against `apps/web/src/app/m/*` instead.
- **Dependencies**: leave them frozen at current versions; do not bump.

## When to revisit

Reopen this conversation if any of the following becomes a hard
requirement:

- App Store / Play Store distribution
- iOS push notifications outside of an installed PWA
- Native-only APIs (HealthKit, ARKit, Apple Pay, etc.)
- Offline maps with vector tiles (Mapbox / MapLibre native SDKs)

For each of those, the PWA + Capacitor wrapper option should be
evaluated before reaching for a full RN rewrite.
