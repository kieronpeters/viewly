import Link from "next/link";
import { Suspense } from "react";

import { VideoGrid } from "@/components/home/video-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  getAccount,
  getMyChannel,
  getSessionAccount,
  listMyUploads,
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

  try {
    const channel = await getMyChannel(account);

    if (!channel) {
      return (
        <EmptyState
          title="No channel found"
          message="This Google account does not have a YouTube channel."
        />
      );
    }

    const videos = channel.uploadsPlaylistId
      ? await listMyUploads(account, channel.uploadsPlaylistId)
      : [];
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
      </div>
    );
  } catch {
    return (
      <ErrorState
        title="Could not load your channel"
        message="YouTube did not answer. Try again in a moment, or sign in again if the session expired."
      />
    );
  }
}
