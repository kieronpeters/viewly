import { CircleUserRound, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { VideoCard } from "@/components/video/video-card";
import { formatSubscriberCount } from "@/shared/format";
import type { ChannelDetail, VideoSummary } from "@/shared/types";

import { readChannel } from "./read-channel";

export interface ChannelPageContentProps {
  /** Next 16 passes `params` as a promise; only this boundary awaits it. */
  params: Promise<{ id: string }>;
}

/**
 * Data half of `/channel/[id]`.
 *
 * Runs inside the page's `<Suspense>` boundary: it awaits the runtime `params`
 * and the guarded `readChannel` read, so the breadcrumb and skeleton stay in the
 * prerendered shell. `readChannel` never throws for an upstream failure:
 *
 * - malformed id or unknown/deleted channel -> segment 404;
 * - failed channel lookup -> authored retry state;
 * - failed uploads lookup -> header renders, only the grid reports the failure.
 */
export async function ChannelPageContent({ params }: ChannelPageContentProps) {
  const { id } = await params;
  const read = await readChannel(id);

  if (read.status === "not_found") {
    notFound();
  }

  if (read.status === "error") {
    return <ChannelLoadError channelId={id} />;
  }

  return (
    <ChannelDetailView
      channel={read.channel}
      uploads={read.uploads}
      uploadsUnavailable={read.uploadsUnavailable}
    />
  );
}

export interface ChannelDetailViewProps {
  /** Already normalized by the YouTube client. */
  channel: ChannelDetail;
  /** Recent uploads, newest first. */
  uploads: readonly VideoSummary[];
  /** True when the uploads call failed or no uploads playlist id was available. */
  uploadsUnavailable: boolean;
}

/**
 * Layout half of the channel route: identity card, then a recent-uploads grid
 * built from the same `VideoCard` as every other list.
 *
 * The subscriber line is omitted when YouTube hides the count, rather than
 * rendered as zero. The description is plain text (`whitespace-pre-line`) so
 * upstream line breaks survive without any HTML reaching the DOM. The outbound
 * link is the channel's own YouTube page and always remains available, even
 * when the uploads grid could not be read.
 */
export function ChannelDetailView({
  channel,
  uploads,
  uploadsUnavailable,
}: ChannelDetailViewProps) {
  const subscribers = formatSubscriberCount(channel.subscriberCount);
  const initial = firstCharacter(channel.title);
  const youtubeUrl = `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`;
  const hasUploads = !uploadsUnavailable && uploads.length > 0;

  return (
    <article aria-labelledby="channel-heading" className="flex min-w-0 flex-col gap-6">
      <header
        data-slot="channel-header"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start sm:p-6"
      >
        {channel.avatarUrl === null ? (
          <span
            aria-hidden="true"
            className="flex size-20 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-2xl font-semibold text-muted-foreground sm:size-24"
          >
            {initial ?? <CircleUserRound className="size-10" />}
          </span>
        ) : (
          <Image
            src={channel.avatarUrl}
            alt=""
            width={96}
            height={96}
            className="size-20 shrink-0 rounded-full border border-border bg-surface object-cover sm:size-24"
          />
        )}

        <div className="flex min-w-0 flex-col gap-2">
          <h1
            id="channel-heading"
            className="text-pretty text-2xl font-semibold tracking-tight break-words text-foreground sm:text-3xl"
          >
            {channel.title}
          </h1>

          {subscribers === null ? null : (
            <p className="text-sm text-muted-foreground">{subscribers}</p>
          )}

          {channel.description === "" ? null : (
            <p className="max-w-3xl text-sm leading-6 whitespace-pre-line break-words text-muted-foreground">
              {channel.description}
            </p>
          )}

          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
            View on YouTube
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </header>

      <section aria-labelledby={hasUploads ? "channel-uploads-heading" : undefined}>
        {uploadsUnavailable ? (
          <ErrorState
            title="Could not load recent uploads"
            message="The channel is available, but YouTube did not return its uploads. Try again in a moment."
          />
        ) : uploads.length === 0 ? (
          <EmptyState
            title="No uploads yet"
            message="This channel has not published any videos that are visible to Viewly."
          />
        ) : (
          <>
            <h2
              id="channel-uploads-heading"
              className="mb-4 text-xl font-semibold tracking-tight text-foreground"
            >
              Recent uploads
            </h2>
            <ul
              role="list"
              aria-labelledby="channel-uploads-heading"
              className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            >
              {uploads.map((video) => (
                <li key={video.id} className="min-w-0">
                  <VideoCard video={video} className="h-full" />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </article>
  );
}

interface ChannelLoadErrorProps {
  /** Validated channel id from the route, used for the retry link. */
  channelId: string;
}

/**
 * Failure state for the channel lookup itself.
 *
 * A quota, auth or transport error does not mean the channel is gone, so this
 * is deliberately not a 404. Retrying is a same-URL navigation; the client cache
 * never stores errors, so the next request really does go upstream.
 */
function ChannelLoadError({ channelId }: ChannelLoadErrorProps) {
  return (
    <section className="flex flex-col items-center gap-3">
      <ErrorState
        title="Could not load this channel"
        message="YouTube did not respond or the API quota is exhausted. The channel may still exist."
      />
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <Link href={`/channel/${encodeURIComponent(channelId)}`} prefetch={false}>
          Try again
        </Link>
      </Button>
    </section>
  );
}

/** First code point of a name, upper-cased, or null when there is none. */
function firstCharacter(name: string): string | null {
  const [first] = Array.from(name);
  return first === undefined ? null : first.toUpperCase();
}
