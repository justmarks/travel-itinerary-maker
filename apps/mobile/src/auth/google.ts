/**
 * Google OAuth via expo-auth-session.
 *
 * The mobile app uses the Authorization Code flow with PKCE, then exchanges
 * the code with our own backend (POST /auth/google) — the same endpoint the
 * web app uses, but with a different redirectUri.
 *
 * On native, the redirect URI is an Expo proxy URL of the form:
 *   https://auth.expo.io/@<owner>/<slug>
 *
 * The backend's POST /auth/google now accepts an optional `redirectUri` in
 * the request body so each client can supply its own value.
 */

import * as AuthSession from "expo-auth-session";
import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL, GOOGLE_CLIENT_ID } from "../config";

WebBrowser.maybeCompleteAuthSession();

const discovery = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
};

export interface GoogleAuthResult {
  user: {
    id: string;
    email: string;
    name: string;
    picture?: string;
  };
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Returns the redirect URI that must be registered in Google Cloud Console
 * for the native app.
 *
 * During development with Expo Go this resolves to:
 *   https://auth.expo.io/@<owner>/travel-itinerary-maker
 *
 * For standalone builds, use the app scheme:
 *   travel-itinerary-maker://
 */
export function getRedirectUri(): string {
  return AuthSession.makeRedirectUri({
    scheme: "travel-itinerary-maker",
    path: "auth",
  });
}

let _request: AuthSession.AuthRequest | null = null;

export async function signInWithGoogle(): Promise<GoogleAuthResult | null> {
  const redirectUri = getRedirectUri();

  const request = new AuthSession.AuthRequest({
    clientId: GOOGLE_CLIENT_ID,
    // Mirror the web app: only request the minimum scopes Google needs
    // to identify the user and store trips in their Drive. Gmail and
    // Calendar are added on demand via incremental authorization once
    // the user opts into a feature that needs them.
    scopes: [
      "openid",
      "profile",
      "email",
      "https://www.googleapis.com/auth/drive.file",
    ],
    redirectUri,
    usePKCE: true,
    extraParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
  });

  _request = request;
  await request.makeAuthUrlAsync(discovery);

  const result = await request.promptAsync(discovery);

  if (result.type !== "success" || !result.params.code) {
    return null;
  }

  // Exchange the code with our backend (which handles Drive API calls server-side)
  const response = await fetch(`${API_BASE_URL}/auth/google`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: result.params.code,
      redirectUri,
      codeVerifier: request.codeVerifier,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Auth exchange failed");
  }

  const data = await response.json();
  return data as GoogleAuthResult;
}

export function signOut(): void {
  _request = null;
}
