# Google sign-in — implementation plan (next work session)

Status: approved, not yet coded. Nothing half-built is committed; the app is unchanged and green.
Setup steps the owner must complete: `docs/GOOGLE-LOGIN-SETUP.md`.

## Goal

Optional read-only Google sign-in so the owner can see **their own channel and uploads**, keep
their playlists/subscriptions, and stay signed in across restarts. No writes to YouTube, no
private history surface. Signed-out use stays exactly as today.

## Storage (SQLite, one migration)

```ts
// src/db/schema.ts
export const authAccounts = sqliteTable("auth_accounts", {
  id: text("id").primaryKey(), // Google subject id
  email: text("email").notNull(),
  name: text("name"),
  avatarUrl: text("avatar_url"),
  refreshToken: text("refresh_token").notNull(),
  accessToken: text("access_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

`npm run db:generate` then `npm run db:migrate`. The table is local-only, like every other table.

## Modules

| File                      | Responsibility                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/auth/config.ts`  | read `GOOGLE_CLIENT_ID/SECRET`, `AUTH_REDIRECT_URI`, `AUTH_SECRET`; `isGoogleConfigured()`                                                                     |
| `src/lib/auth/session.ts` | HMAC-SHA256 signed httpOnly cookie (`viewly_session`), `createSession/readSession/clearSession`, `sameSite=lax`, `secure` in production                        |
| `src/lib/auth/oauth.ts`   | PKCE verifier/challenge, random `state`, `buildAuthorizeUrl`, `exchangeCode`, `refreshAccessToken`, `fetchUserInfo`, transient state/verifier cookies (10 min) |
| `src/lib/auth/store.ts`   | upsert/read/delete the account row; refresh-token rotation helper                                                                                              |
| `src/lib/auth/youtube.ts` | authed `fetch` with automatic refresh; `getMyChannel`, `listMyUploads`, `listMySubscriptions`, `listMyPlaylists`                                               |

Scopes: `openid email profile https://www.googleapis.com/auth/youtube.readonly`.

## Routes

- `GET /api/auth/google/start` — sets state + PKCE cookies, redirects to Google.
- `GET /api/auth/google/callback` — validates state, exchanges the code, stores the account,
  sets the session cookie, redirects to `/you`; errors redirect to `/you?auth=error` with authored
  copy (never the upstream message).
- `POST /api/auth/signout` — deletes the account row and clears the cookie, redirects to `/`.

## UI

- Masthead account slot (server component behind `<Suspense>`): "Sign in" link when signed out;
  avatar/email menu with **Your videos**, **Subscriptions**, **Sign out** when signed in.
- `/you` — the owner's channel header and their uploads grid (`channels.list` + uploads playlist);
  a quiet "sign-in not configured" state when env vars are absent.
- `/subscriptions` — channel cards from `subscriptions.list`.
- `/privacy` — required YouTube API Services / Google privacy / terms links.
- Graceful degradation: every page renders signed-out content without the env vars.

## Tests

- `oauth.test.ts`: state length/entropy, PKCE S256 challenge, authorize URL params, callback state
  mismatch rejection (fetch mocked).
- `session.test.ts`: sign/verify round trip, tamper rejection, expiry.
- `youtube.test.ts`: refresh-on-401, no refresh loop, quota error mapped to a stable code.
- Existing suite must stay green; no new network in tests.

## Acceptance

1. With credentials: sign-in → `/you` shows the owner's channel and uploads; restart the app and
   `/you` still works without re-consent (refresh token persisted).
2. Sign out removes the row and the cookie; a second sign-in works.
3. Without credentials: masthead shows "Sign in" only, `/you` explains the setup, everything else
   unchanged.
4. `npm test`, `typecheck`, `format:check`, `build` green; committed and pushed.

## Deliberately excluded

Reading YouTube watch history (no official API), writing history/views back to YouTube, and any
like/subscribe/comment writes.
