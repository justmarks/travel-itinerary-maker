# Travel Itinerary Maker — Mobile App

React Native / Expo app for viewing travel itineraries on Android (and eventually iOS).

## Status

**Scaffold only.** Authentication flow and trip list screen are wired up; full itinerary viewing and editing is in progress.

## Stack

| | |
|---|---|
| Framework | Expo SDK 55 (React Native 0.77, React 19) |
| Auth | `expo-auth-session` + PKCE — exchanges code with the shared backend |
| Build | EAS Build (development APK → preview APK → production) |
| Monorepo | pnpm workspace — shares `@travel-app/shared` types with the web app |

## Getting started

### Prerequisites

- Node.js ≥ 20 and pnpm 10
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`
- Android device or emulator (AVD)

### Install

From the monorepo root:

```bash
pnpm install
```

### Environment

Create `apps/mobile/.env`:

```
EXPO_PUBLIC_API_BASE_URL=http://<your-local-ip>:3001/api/v1
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
```

Use your machine's LAN IP (not `localhost`) when testing on a physical device.

### Google Cloud Console setup

The mobile app uses a **native OAuth client** — add a separate credential in Google Cloud Console:

1. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
2. Application type: **Android** (or iOS)
3. Add the package name: `com.justmarks.travelitinerarymaker`
4. For Android, add the SHA-1 fingerprint from `eas credentials`
5. Also add an **authorized redirect URI** for the Expo proxy:
   `https://auth.expo.io/@<your-expo-username>/travel-itinerary-maker`

### Run in Expo Go (quickest)

```bash
cd apps/mobile
pnpm start          # or: expo start
# Scan QR with Expo Go on your device
```

> Note: the Expo Go redirect URI (`https://auth.expo.io/...`) must be added to your Google Cloud Console OAuth client's authorized redirect URIs.

### Run with dev client (recommended for native modules)

```bash
# Build a dev client APK first (one-time):
eas build --profile development --platform android

# Then start the dev server pointing at your installed dev client:
pnpm start --dev-client
```

### Production build

```bash
eas build --profile production --platform android
eas submit --platform android   # upload to Play Store
```

## Project layout

```
apps/mobile/
├── App.tsx              # Root component — auth gate + trip list
├── app.json             # Expo config (slug, bundle ID, plugins)
├── eas.json             # EAS Build profiles
├── metro.config.js      # Metro config for monorepo symlinks
├── src/
│   ├── config.ts        # EXPO_PUBLIC_* env vars
│   ├── auth/
│   │   └── google.ts    # expo-auth-session PKCE flow
│   └── api/
│       └── client.ts    # Typed fetch wrappers (trips, etc.)
└── README.md
```

## Backend compatibility

The mobile app exchanges OAuth codes with the same `POST /api/v1/auth/google` endpoint as the web app. The key difference is the `redirectUri`: the web app uses `"postmessage"` (popup flow), while the mobile app sends its Expo / native redirect URI.

The backend accepts an optional `redirectUri` field in the request body and falls back to `"postmessage"` when absent, so existing web clients are unaffected.
