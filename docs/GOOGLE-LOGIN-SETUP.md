# Google / YouTube sign-in setup (owner, one-time)

Viewly's optional sign-in is **read-only**: it reads your subscriptions, playlists (including
Watch Later and Liked videos) and channel identity through the official YouTube Data API. It never
likes, subscribes, comments or writes history to YouTube.

There is no official API for YouTube watch history. To see your real history in Viewly, import
your own Google Takeout export (see the end of this file).

## 1. Google Cloud project

1. Open <https://console.cloud.google.com/> and create (or pick) a project.
2. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.

## 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type **External**, then fill app name, support email and developer email.
3. **Scopes**: add `https://www.googleapis.com/auth/youtube.readonly`.
   Optional, only if you want the account email shown: add `.../auth/userinfo.email`.
4. While the app is in **Testing**, add your own Google account under **Test users**.
   (Testing tokens expire after 7 days, so for daily use either publish the app or re-consent.)

## 3. OAuth client

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add exactly:
   - `http://localhost:3000/api/auth/callback`
   - optionally `http://localhost:3001/api/auth/callback` and `http://localhost:3100/api/auth/callback`
4. Copy the **client ID** and **client secret**.

## 4. Configure Viewly

Add to `.env.local` (never commit this file):

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
AUTH_SECRET=<random string, 32+ chars, e.g. `openssl rand -base64 32`>
AUTH_REDIRECT_URI=http://localhost:3000/api/auth/callback
```

Restart `npm run dev`. The masthead then shows **Sign in with Google**; without these variables it
shows a quiet "sign-in not configured" state and the rest of the app works exactly as now.

## 5. Data that is stored

- A refresh token and the account email in the local SQLite file (single-user machine).
- Nothing is sent anywhere except Google's OAuth and YouTube Data API endpoints.
- **Sign out** deletes the stored token; deleting `data/viewly.db` removes everything.

## 6. Import your real watch history (Google Takeout)

1. Open <https://takeout.google.com/>, deselect all, select **YouTube and YouTube Music** →
   **history** → JSON format, then export.
2. In Viewly: **Library → Import history** and pick `watch-history.json`.
3. Viewly maps each entry to a local history row by video id and skips duplicates. It makes no
   network calls to YouTube for this import.

This is your own exported data; it is not scraped from a private surface and it does not write
anything back to YouTube.

## 7. What is intentionally not supported

- Reading YouTube watch history via an API (none exists).
- Writing views/history back to `youtube.com` (only playback on youtube.com records history).
- Likes, subscriptions, comments or any other write through the API.
