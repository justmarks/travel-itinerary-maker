/**
 * In-memory store for user refresh tokens.
 * Populated when users authenticate via POST /auth/google.
 * Used by shared routes to create DriveStorage on behalf of trip owners.
 *
 * In production, this could be backed by Redis or a persistent store.
 */

import { google } from "googleapis";
import { config } from "../config/env";

export interface TokenEntry {
  userId: string;
  refreshToken: string;
  email: string;
  updatedAt: string;
}

export class TokenStore {
  private tokens: Map<string, TokenEntry> = new Map();

  /** Store a user's refresh token after login */
  set(userId: string, refreshToken: string, email: string): void {
    this.tokens.set(userId, {
      userId,
      refreshToken,
      email,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Get a stored refresh token by user ID */
  get(userId: string): TokenEntry | undefined {
    return this.tokens.get(userId);
  }

  /**
   * List every userId we currently have a refresh token for. Used by the
   * shared-route recovery path: if the in-memory share registry was wiped
   * by a server restart but the tokenStore is still populated, we can
   * scan known users' Drives looking for the requested share token.
   */
  listUserIds(): string[] {
    return Array.from(this.tokens.keys());
  }

  /** Get a fresh access token for a user using their stored refresh token */
  async getAccessToken(userId: string): Promise<string | null> {
    const entry = this.get(userId);
    if (!entry) return null;

    try {
      const oauth2Client = new google.auth.OAuth2(
        config.google.clientId,
        config.google.clientSecret,
      );
      oauth2Client.setCredentials({ refresh_token: entry.refreshToken });

      const { credentials } = await oauth2Client.refreshAccessToken();
      return credentials.access_token ?? null;
    } catch {
      return null;
    }
  }

  /** Remove a user's token */
  remove(userId: string): void {
    this.tokens.delete(userId);
  }

  /** Clear all tokens (for testing) */
  clear(): void {
    this.tokens.clear();
  }
}
