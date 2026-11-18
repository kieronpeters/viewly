import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { VideoGrid } from "@/components/home/video-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  getAccount,
  getMyChannel,
  getSessionAccount,
  listMySubscriptions,
  listMyUploads,
  listPlaylistVideos,
  readGoogleConfig,
} from "@/lib/auth/google";
import { formatSubscriberCount } from "@/shared/format";

/**
 * The signed-in owner's own channel and recent uploads.
 *
 * Everything here is read-only: the channel and its uploads come from the
 * official Data API with the stored refresh token. Without OAuth credentials,
 * or without a session, the page explains the next step instead of failing.
 */
export default function YouPage({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="px-4 py-10 text-sm text-muted-foreground">Loading your account…</div>
      }
    >
      <YouContent searchParams={searchParams} />
    </Suspense>
  );
}

type YouView =
  | { status: "error" }
  | { status: "no-channel" }
  | {
      status: "ok";
      channel: NonNullable<Awaited<ReturnType<typeof getMyChannel>>>;
      videos: Awaited<ReturnType<typeof listMyUploads>>;
      liked: Awaited<ReturnType<typeof listPlaylistVideos>> | null;
      watchLater: Awaited<ReturnType<typeof listPlaylistVideos>> | null;
      subscriptions: Awaited<ReturnType<typeof listMySubscriptions>> | null;
    };

/**
 * Loads everything the signed-in view renders, without constructing JSX, so a
 * failure is a status rather than an error thrown out of a render.
 */
async function loadYouView(account: NonNullable<ReturnType<typeof getAccount>>): Promise<YouView> {
  try {
    const channel = await getMyChannel(account);

    if (!channel) {
      return { status: "no-channel" };
    }

    const videos = channel.uploadsPlaylistId
      ? await listMyUploads(account, channel.uploadsPlaylistId)
      : [];
    const [liked, watchLater, subscriptions] = await Promise.all([
      listPlaylistVideos(account, `LL${channel.id}`, 12).catch(() => null),
      listPlaylistVideos(account, "WL", 12).catch(() => null),
      listMySubscriptions(account, 24).catch(() => null),
    ]);

    return { status: "ok", channel, videos, liked, watchLater, subscriptions };
  } catch {
    return { status: "error" };
  }
}

async function YouContent({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const { auth } = await searchParams;
  const config = readGoogleConfig();

  if (!config) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
        <p className="text-muted-foreground">
          Google sign-in is not configured on this machine yet. Add
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-sm">GOOGLE_CLIENT_ID</code>,
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-sm">GOOGLE_CLIENT_SECRET</code>
          and
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5 text-sm">AUTH_SECRET</code>
          to <code className="rounded bg-muted px-1.5 py-0.5 text-sm">.env.local</code>, then
          restart.
        </p>
        <p className="text-sm text-muted-foreground">
          The one-time Google Cloud steps are in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 text-sm">docs/GOOGLE-LOGIN-SETUP.md</code>
          .
        </p>
      </div>
    );
  }

  const session = await getSessionAccount();

  if (!session) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
        {auth === "failed" ? (
          <p role="alert" className="text-sm text-destructive">
            Sign-in did not complete. Please try again.
          </p>
        ) : null}
        <p className="text-muted-foreground">
          Sign in with Google to see your own channel and uploads. Viewly reads them read-only and
          never posts, likes or changes anything on YouTube.
        </p>
        <Link
          href="/api/auth/google/start"
          className="inline-flex w-fit items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Sign in with Google
        </Link>
      </div>
    );
  }

  const account = getAccount(session.id);

  if (!account) {
    return <ErrorState title="Account unavailable" message="Sign in again to continue." />;
  }

  const view = await loadYouView(account);

  if (view.status === "error") {
    return (
      <ErrorState
        title="Could not load your channel"
        message="YouTube did not answer. Try again in a moment, or sign in again if the session expired."
      />
    );
  }

  if (view.status === "no-channel") {
    return (
      <EmptyState
        title="No channel found"
        message="This Google account does not have a YouTube channel."
      />
    );
  }

  const { channel, videos, liked, watchLater, subscriptions } = view;
  const subscribers = formatSubscriberCount(channel.subscriberCount);

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">{channel.title}</h1>
        {subscribers === null ? null : (
          <p className="text-sm text-muted-foreground">{subscribers}</p>
        )}
        <a
          href={`https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Open on YouTube
        </a>
      </header>

      <section aria-labelledby="you-uploads-heading" className="flex flex-col gap-4">
        <h2 id="you-uploads-heading" className="text-xl font-semibold">
          Your recent uploads
        </h2>
        {videos.length === 0 ? (
          <EmptyState title="No uploads yet" message="This channel has no public videos." />
        ) : (
          <VideoGrid labelledBy="you-uploads-heading" videos={videos} />
        )}
      </section>

      {liked === null ? null : (
        <section aria-labelledby="you-liked-heading" className="flex flex-col gap-4">
          <h2 id="you-liked-heading" className="text-xl font-semibold">
            Liked videos
          </h2>
          {liked.length === 0 ? (
            <p className="text-sm text-muted-foreground">No liked videos on this account.</p>
          ) : (
            <VideoGrid labelledBy="you-liked-heading" videos={liked} />
          )}
        </section>
      )}

      {watchLater === null ? null : (
        <section aria-labelledby="you-watch-later-heading" className="flex flex-col gap-4">
          <h2 id="you-watch-later-heading" className="text-xl font-semibold">
            Watch Later
          </h2>
          {watchLater.length === 0 ? (
            <p className="text-sm text-muted-foreground">Watch Later is empty.</p>
          ) : (
            <VideoGrid labelledBy="you-watch-later-heading" videos={watchLater} />
          )}
        </section>
      )}

      {subscriptions === null || subscriptions.length === 0 ? null : (
        <section aria-labelledby="you-subscriptions-heading" className="flex flex-col gap-4">
          <h2 id="you-subscriptions-heading" className="text-xl font-semibold">
            Subscriptions
          </h2>
          <ul role="list" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {subscriptions.map((subscription) => (
              <li key={subscription.id} className="min-w-0">
                <Link
                  href={`/channel/${encodeURIComponent(subscription.id)}`}
                  className="flex items-center gap-3 rounded-xl border border-border p-3 hover:bg-muted"
                >
                  {subscription.thumbnailUrl === null ? null : (
                    <Image
                      src={subscription.thumbnailUrl}
                      alt=""
                      width={40}
                      height={40}
                      unoptimized
                      className="size-10 shrink-0 rounded-full object-cover"
                    />
                  )}
                  <span className="min-w-0 truncate text-sm font-medium">{subscription.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2 border-t border-border pt-4">
        <h2 className="text-sm font-semibold text-muted-foreground">YouTube history</h2>
        <p className="text-sm text-muted-foreground">
          YouTube has no history API, so views here cannot write back. Import your own Takeout
          export to bring real history into Viewly.
        </p>
        <Link
          href="/library/import"
          className="w-fit rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Import watch history
        </Link>
      </section>
    </div>
  );
}
