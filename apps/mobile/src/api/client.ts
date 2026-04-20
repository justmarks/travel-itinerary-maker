/**
 * Minimal API client for the mobile app.
 *
 * The full typed client lives in packages/api-client (React Query-based).
 * This module provides simple fetch wrappers for the screens that don't
 * need query caching yet.
 */

import type { Trip } from "@travel-app/shared";
import { API_BASE_URL } from "../config";

function authHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function fetchTrips(accessToken: string): Promise<Trip[]> {
  const res = await fetch(`${API_BASE_URL}/trips`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to fetch trips: ${res.status}`);
  return res.json();
}

export async function fetchTrip(
  accessToken: string,
  tripId: string
): Promise<Trip> {
  const res = await fetch(`${API_BASE_URL}/trips/${tripId}`, {
    headers: authHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Failed to fetch trip: ${res.status}`);
  return res.json();
}
