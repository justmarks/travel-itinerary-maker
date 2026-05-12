/**
 * Per-user OAuth connection storage. Phase 3 of the Drive→Supabase
 * migration.
 *
 * Backed by the `connections` table introduced in commit 1. Tokens
 * are AES-256-GCM encrypted at rest via the existing
 * `token-crypto.ts` helpers; reads decrypt on the way out. The store
 * is the canonical source of truth for provider tokens for any user
 * who signed in via Supabase Auth — the legacy `TokenStore` (Redis)
 * still backs pre-Supabase Google sessions until phase 5 imports
 * them across.
 *
 * Semantics:
 * - `upsert` is the safe write path: same `(user, provider,
 *   capability, account_email)` re-saves token + scopes; status
 *   stays `active`.
 * - `delete` is a soft delete — sets `status='revoked'` so audit
 *   trails and "you used to have X connected" UX still see the row.
 *   Pair with a real provider-side token revoke at the call site
 *   (commit 5 implements that).
 * - `getActive` filters by `status='active'`; revoked connections
 *   stay queryable via `getById` for the same audit reason.
 */

import { and, eq } from "drizzle-orm";
import type { Db, DbClient } from "../db/client";
import { connections } from "../db/schema";
import {
  decryptToken,
  encryptToken,
  isEncrypted,
  loadEncryptionKey,
} from "./token-crypto";

export type ConnectionProvider = "google" | "microsoft";
export type ConnectionCapability = "identity" | "email" | "calendar";
export type ConnectionStatus = "active" | "revoked";

export interface Connection {
  id: string;
  userId: string;
  provider: ConnectionProvider;
  capability: ConnectionCapability;
  accountEmail: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: Date;
  scopes: string[];
  status: ConnectionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionUpsertInput {
  id: string;
  userId: string;
  provider: ConnectionProvider;
  capability: ConnectionCapability;
  accountEmail: string;
  refreshToken?: string;
  accessToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export class ConnectionsStore {
  private db: Db;
  private encryptionKey: Buffer | null;

  constructor(dbClient: DbClient, encryptionKey?: Buffer | null) {
    this.db = dbClient.db;
    // Fall back to env-driven loading so callers don't have to wire
    // it through every construction site (tests pass `null` to skip
    // encryption entirely).
    this.encryptionKey =
      encryptionKey === undefined ? loadEncryptionKey() : encryptionKey;
  }

  /** List active connections owned by a user. Tokens are decrypted. */
  async listForUser(userId: string): Promise<Connection[]> {
    const rows = await this.db
      .select()
      .from(connections)
      .where(
        and(eq(connections.userId, userId), eq(connections.status, "active")),
      );
    return rows.map((row) => this.rowToConnection(row));
  }

  /** Find an active connection by composite key. Returns null if missing. */
  async findByKey(args: {
    userId: string;
    provider: ConnectionProvider;
    capability: ConnectionCapability;
    accountEmail: string;
  }): Promise<Connection | null> {
    const email = normalizeEmail(args.accountEmail);
    const rows = await this.db
      .select()
      .from(connections)
      .where(
        and(
          eq(connections.userId, args.userId),
          eq(connections.provider, args.provider),
          eq(connections.capability, args.capability),
          eq(connections.accountEmail, email),
        ),
      );
    if (rows.length === 0) return null;
    return this.rowToConnection(rows[0]);
  }

  /** Look up by row id. Includes revoked rows so the caller can show audit info. */
  async getById(id: string): Promise<Connection | null> {
    const rows = await this.db
      .select()
      .from(connections)
      .where(eq(connections.id, id));
    if (rows.length === 0) return null;
    return this.rowToConnection(rows[0]);
  }

  /**
   * Upsert by composite key — same `(user, provider, capability,
   * account_email)` rewrites tokens + scopes and bumps `updated_at`,
   * keeping the row id stable. A previously-revoked row flips back to
   * `active`.
   */
  async upsert(input: ConnectionUpsertInput): Promise<Connection> {
    const email = normalizeEmail(input.accountEmail);
    const refreshEnc = this.encrypt(input.refreshToken);
    const accessEnc = this.encrypt(input.accessToken);
    const now = new Date();

    // Don't clobber the existing refresh_token when the caller has
    // no new one to give us. Returning users doing signInWithOAuth
    // frequently get a valid access_token without a fresh
    // refresh_token (Google won't re-issue one to a user with an
    // active grant even with `prompt=consent`; Microsoft sometimes
    // skips it too). Without this guard, every "Reconnect"
    // attempt that doesn't yield a refresh_token wiped the working
    // one the row already had.
    //
    // Same logic for scopes: if the caller passes [] we leave the
    // existing scopes alone (the connect flow uses [] for the
    // identity row write, which would otherwise clear capability
    // scopes on the same provider).
    const conflictSet: Record<string, unknown> = {
      accessTokenEncrypted: accessEnc,
      expiresAt: input.expiresAt ?? null,
      status: "active",
      updatedAt: now,
    };
    if (refreshEnc !== null) conflictSet.refreshTokenEncrypted = refreshEnc;
    if (input.scopes && input.scopes.length > 0) {
      conflictSet.scopes = input.scopes;
    }

    await this.db
      .insert(connections)
      .values({
        id: input.id,
        userId: input.userId,
        provider: input.provider,
        capability: input.capability,
        accountEmail: email,
        refreshTokenEncrypted: refreshEnc,
        accessTokenEncrypted: accessEnc,
        expiresAt: input.expiresAt ?? null,
        scopes: input.scopes ?? [],
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          connections.userId,
          connections.provider,
          connections.capability,
          connections.accountEmail,
        ],
        set: conflictSet,
      });

    // Re-read to get the canonical row (handles the case where the
    // upsert hit an existing row keyed differently than the input id).
    const found = await this.findByKey({
      userId: input.userId,
      provider: input.provider,
      capability: input.capability,
      accountEmail: email,
    });
    if (!found) {
      throw new Error(
        "ConnectionsStore.upsert: row vanished between insert and read",
      );
    }
    return found;
  }

  /**
   * Soft delete — flip status to `revoked`. Returns true if a row was
   * updated, false otherwise. Caller should also revoke at the
   * provider before calling this so the row's recorded state matches
   * reality.
   */
  async markRevoked(id: string, userId: string): Promise<boolean> {
    const result = await this.db
      .update(connections)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(and(eq(connections.id, id), eq(connections.userId, userId)))
      .returning({ id: connections.id });
    return result.length > 0;
  }

  /** Hard delete — only for tests. Bypasses the soft-delete semantics. */
  async hardDeleteForUser(userId: string): Promise<void> {
    await this.db.delete(connections).where(eq(connections.userId, userId));
  }

  private encrypt(plaintext: string | undefined): string | null {
    if (!plaintext) return null;
    if (!this.encryptionKey) return plaintext;
    return encryptToken(plaintext, this.encryptionKey);
  }

  private decrypt(ciphertext: string | null): string | undefined {
    if (!ciphertext) return undefined;
    if (!this.encryptionKey) return ciphertext;
    // Legacy plaintext entries (encryption added later) are detected
    // by their lack of the `v1:` prefix — matches the TokenStore
    // back-compat path.
    if (!isEncrypted(ciphertext)) return ciphertext;
    return decryptToken(ciphertext, this.encryptionKey);
  }

  private rowToConnection(
    row: typeof connections.$inferSelect,
  ): Connection {
    return {
      id: row.id,
      userId: row.userId,
      provider: row.provider as ConnectionProvider,
      capability: row.capability as ConnectionCapability,
      accountEmail: row.accountEmail,
      refreshToken: this.decrypt(row.refreshTokenEncrypted),
      accessToken: this.decrypt(row.accessTokenEncrypted),
      expiresAt: row.expiresAt ?? undefined,
      scopes: (row.scopes ?? []) as string[],
      status: row.status as ConnectionStatus,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
