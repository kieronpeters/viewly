export const metadata = {
  title: "Privacy · Viewly",
};

/**
 * Privacy and terms screen for the optional Google sign-in.
 *
 * The YouTube API Services terms require a visible statement naming the service,
 * linking its terms and the Google privacy policy, and explaining what is stored.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10 text-sm leading-6">
      <h1 className="text-2xl font-bold tracking-tight">Privacy and YouTube terms</h1>

      <p>
        Viewly runs on this machine for a single person. It has no accounts, no cloud database and
        no analytics. Data you save stays in a local SQLite file.
      </p>

      <h2 className="mt-2 text-lg font-semibold">Optional Google sign-in</h2>
      <p>
        If you choose to sign in, Viewly uses Google OAuth and the YouTube API Services to read your
        own channel, uploads and (when present) account identity. It never posts, likes, subscribes,
        comments or writes watch history to YouTube. By using this feature you agree to the{" "}
        <a
          className="underline underline-offset-4"
          href="https://www.youtube.com/t/terms"
          target="_blank"
          rel="noopener noreferrer"
        >
          YouTube Terms of Service
        </a>
        .
      </p>
      <p>
        The refresh token and the account email are stored locally in the SQLite database. Signing
        out deletes them. Google&apos;s handling of your data is described in the{" "}
        <a
          className="underline underline-offset-4"
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Privacy Policy
        </a>
        .
      </p>

      <h2 className="mt-2 text-lg font-semibold">Without sign-in</h2>
      <p>
        The rest of Viewly works signed out. Any saved video metadata comes from the YouTube Data
        API with the owner&apos;s own key, and thumbnails load from YouTube&apos;s hosts.
      </p>
    </div>
  );
}
