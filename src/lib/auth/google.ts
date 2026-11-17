import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import { getDatabaseConnection } from "@/lib/db/client";

/**
 * Optional, read-only Google sign-in.
 *
 * Reads the owner's own channel, uploads and subscriptions through the official
 * YouTube Data API with the `youtube.readonly` scope. The refresh token is kept
 * in the local SQLite file so a restart keeps the session; the browser only
 * holds an HMAC-signed account id, never a token. Nothing is written to YouTube.
 */

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

const SESSION_COOKIE = "viewly_session";
const STATE_COOKIE = "viewly_oauth_state";
const VERIFIER_COOKIE = "viewly_oauth_verifier";
const COOKIE_PATH = "/";

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  secret: string;
}

/** Returns the OAuth config, or null when sign-in has not been set up yet. */
export function readGoogleConfig(): GoogleConfig | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  const secret = (process.env.AUTH_SECRET ?? "").trim();
  const redirectUri =
    (process.env.AUTH_REDIRECT_URI ?? "").trim() || "http://localhost:3000/api/auth/callback";

  if (clientId === "" || clientSecret === "" || secret === "") {
    return null;
  }

  return { clientId, clientSecret, redirectUri, secret };
}

export interface Account {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface AccountRow extends Account {
  refreshToken: string;
  accessToken: string | null;
  accessTokenExpiresAt: number | null;
}

/** Idempotent table creation: a migration is generated in the next change. */
let tableReady = false;

function ensureTable(): void {
  if (tableReady) return;

  getDatabaseConnection().sqlite.exec(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      avatar_url TEXT,
      refresh_token TEXT NOT NULL,
      access_token TEXT,
      access_token_expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  tableReady = true;
}

export function getAccount(id: string): AccountRow | null {
  ensureTable();

  const row = getDatabaseConnection()
    .sqlite.prepare("SELECT * FROM auth_accounts WHERE id = ?")
    .get(id) as
    | {
        id: string;
        email: string;
        name: string | null;
        avatar_url: string | null;
        refresh_token: string;
        access_token: string | null;
        access_token_expires_at: number | null;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    refreshToken: row.refresh_token,
    accessToken: row.access_token,
    accessTokenExpiresAt: row.access_token_expires_at,
  };
}

export function saveAccount(
  account: Account,
  tokens: { refreshToken: string | null; accessToken: string; expiresIn: number },
): void {
  ensureTable();

  const now = Date.now();
  const expiresAt = now + tokens.expiresIn * 1000;
  const connection = getDatabaseConnection();
  const existing = getAccount(account.id);

  // Google only returns a refresh token on the first consent; keep the stored one.
  const refreshToken = tokens.refreshToken ?? existing?.refreshToken ?? "";

  connection.sqlite
    .prepare(
      `INSERT INTO auth_accounts
         (id, email, name, avatar_url, refresh_token, access_token, access_token_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         refresh_token = excluded.refresh_token,
         access_token = excluded.access_token,
         access_token_expires_at = excluded.access_token_expires_at,
         updated_at = excluded.updated_at`,
    )
    .run(
      account.id,
      account.email,
      account.name,
      account.avatarUrl,
      refreshToken,
      tokens.accessToken,
      expiresAt,
      now,
      now,
    );
}

export function deleteAccount(id: string): void {
  ensureTable();
  getDatabaseConnection().sqlite.prepare("DELETE FROM auth_accounts WHERE id = ?").run(id);
}

// --- session cookie -------------------------------------------------------

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function setSession(accountId: string, secret: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, `${accountId}.${sign(accountId, secret)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: COOKIE_PATH,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Returns the signed-in account, or null. Reads only cookies, never tokens. */
export async function getSessionAccount(): Promise<Account | null> {
  const config = readGoogleConfig();
  if (!config) return null;

  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;

  const id = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!safeEqual(signature, sign(id, config.secret))) return null;

  return getAccount(id);
}

// --- OAuth ----------------------------------------------------------------

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function challengeFor(verifier: string): string {
  return base64Url(createHash("sha256").update(verifier).digest());
}

export interface AuthStart {
  url: string;
  state: string;
  verifier: string;
}

export async function beginAuthorization(config: GoogleConfig): Promise<AuthStart> {
  const state = base64Url(randomBytes(24));
  const verifier = base64Url(randomBytes(48));
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });

  const store = await cookies();
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: COOKIE_PATH,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
  };
  store.set(STATE_COOKIE, state, options);
  store.set(VERIFIER_COOKIE, verifier, options);

  return { url: `${AUTHORIZE_URL}?${params.toString()}`, state, verifier };
}

export async function readAuthAttempt(): Promise<{
  state: string | null;
  verifier: string | null;
}> {
  const store = await cookies();
  return {
    state: store.get(STATE_COOKIE)?.value ?? null,
    verifier: store.get(VERIFIER_COOKIE)?.value ?? null,
  };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`token_exchange_failed_${response.status}`);
  }

  return (await response.json()) as TokenResponse;
}

export async function exchangeCode(
  config: GoogleConfig,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  return postToken({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
}

async function refreshToken(config: GoogleConfig, refresh: string): Promise<TokenResponse> {
  return postToken({
    refresh_token: refresh,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
  });
}

export async function fetchUserInfo(accessToken: string): Promise<Account> {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`userinfo_failed_${response.status}`);
  }

  const json = (await response.json()) as {
    sub: string;
    email?: string;
    name?: string;
    picture?: string;
  };

  return {
    id: json.sub,
    email: json.email ?? "",
    name: json.name ?? null,
    avatarUrl: json.picture ?? null,
  };
}

// --- authenticated YouTube calls -----------------------------------------

async function accountAccessToken(account: AccountRow): Promise<string> {
  const config = readGoogleConfig();
  if (!config) throw new Error("google_not_configured");

  const stillValid =
    account.accessToken !== null &&
    account.accessTokenExpiresAt !== null &&
    account.accessTokenExpiresAt > Date.now() + 30_000;

  if (stillValid) return account.accessToken as string;

  const tokens = await refreshToken(config, account.refreshToken);
  saveAccount(account, {
    refreshToken: tokens.refresh_token ?? null,
    accessToken: tokens.access_token,
    expiresIn: tokens.expires_in,
  });

  return tokens.access_token;
}

async function youtubeGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, string>,
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${YOUTUBE_API}/${path}?${query}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`youtube_api_failed_${response.status}`);
  }

  return (await response.json()) as T;
}

export interface MyChannel {
  id: string;
  title: string;
  description: string;
  avatarUrl: string | null;
  subscriberCount: number | null;
  uploadsPlaylistId: string | null;
}

export interface MyVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number | null;
  viewCount: number | null;
}

export async function getMyChannel(account: AccountRow): Promise<MyChannel | null> {
  const token = await accountAccessToken(account);
  const json = await youtubeGet<{
    items?: {
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        thumbnails?: { default?: { url?: string } };
      };
      statistics?: { subscriberCount?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }[];
  }>("channels", token, { part: "snippet,statistics,contentDetails", mine: "true" });

  const item = json.items?.[0];
  if (!item) return null;

  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
    avatarUrl: item.snippet?.thumbnails?.default?.url ?? null,
    subscriberCount: item.statistics?.subscriberCount
      ? Number(item.statistics.subscriberCount)
      : null,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export async function listMyUploads(
  account: AccountRow,
  uploadsPlaylistId: string,
  limit = 24,
): Promise<MyVideo[]> {
  const token = await accountAccessToken(account);
  const json = await youtubeGet<{
    items?: {
      snippet?: {
        title?: string;
        publishedAt?: string;
        channelTitle?: string;
        thumbnails?: { high?: { url?: string }; medium?: { url?: string } };
      };
      contentDetails?: { videoId?: string };
    }[];
  }>("playlistItems", token, {
    part: "snippet,contentDetails",
    playlistId: uploadsPlaylistId,
    maxResults: String(Math.min(limit, 50)),
  });

  const ids = (json.items ?? [])
    .map((item) => item.contentDetails?.videoId)
    .filter((id): id is string => typeof id === "string" && id !== "");

  if (ids.length === 0) return [];

  const details = await youtubeGet<{
    items?: {
      id: string;
      snippet?: {
        title?: string;
        channelId?: string;
        channelTitle?: string;
        publishedAt?: string;
        thumbnails?: { high?: { url?: string } };
      };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string };
    }[];
  }>("videos", token, { part: "snippet,contentDetails,statistics", id: ids.join(",") });

  return (details.items ?? []).map((item) => ({
    id: item.id,
    title: item.snippet?.title ?? "",
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "",
    thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? "",
    publishedAt: item.snippet?.publishedAt ?? new Date(0).toISOString(),
    durationSeconds: parseDuration(item.contentDetails?.duration ?? ""),
    viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : null,
  }));
}

/** `PT1H2M3S` -> 3723. Null when the duration is absent or malformed. */
export function parseDuration(iso: string): number | null {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return null;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return null;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}
