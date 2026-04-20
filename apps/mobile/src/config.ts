/**
 * Runtime configuration for the mobile app.
 *
 * Set these via a `.env` file at apps/mobile/.env (Expo reads it automatically):
 *
 *   EXPO_PUBLIC_API_BASE_URL=https://your-railway-backend.up.railway.app/api/v1
 *   EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-google-oauth-client-id
 *
 * During local development the defaults below point at the Express dev server.
 * Use the LAN IP (not localhost) when testing on a physical device.
 */

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3001/api/v1";

export const GOOGLE_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? "";
