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

import { ChannelTabs } from "./channel-tabs";
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
 * Layout half of the channel route, shaped like the observed surface: a banner
 * strip, a large avatar with the name and subscriber count, an off-site link,
 * then a tab bar (Videos / About). The uploads grid is the Videos panel.
 *
 * Viewly's channel data has no banner artwork, so the strip is a brand gradient
 * rather than a copied image. The description lives in the About panel; the
 * header keeps identity and the outbound link, which always remains available
 * even when uploads could not be read.
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

  const avatar =
    channel.avatarUrl === null ? (
      <span
        aria-hidden="true"
        className="flex size-24 shrink-0 items-center justify-center rounded-full bg-surface text-3xl font-semibold text-muted-foreground ring-4 ring-background sm:size-40"
      >
        {initial ?? <CircleUserRound className="size-10" />}
      </span>
    ) : (
      <Image
        src={channel.avatarUrl}
        alt=""
        width={160}
        height={160}
        className="size-24 shrink-0 rounded-full bg-surface object-cover ring-4 ring-background sm:size-40"
      />
    );

  const uploadsSection = (
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
            className="grid grid-cols-1 gap-x-4 gap-y-9 sm:grid-cols-2 lg:grid-cols-3"
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
  );

  const aboutSection = (
    <div className="flex max-w-3xl flex-col gap-3">
      <h2 className="text-base font-semibold text-foreground">About</h2>
      {channel.description === "" ? (
        <p className="text-sm text-muted-foreground">
          No description was provided by this channel.
        </p>
      ) : (
        <p className="text-sm leading-6 break-words whitespace-pre-line text-muted-foreground">
          {channel.description}
        </p>
      )}
    </div>
  );

  return (
    <article aria-labelledby="channel-heading" className="flex min-w-0 flex-col gap-4">
      <header data-slot="channel-header" className="flex flex-col">
        <div
          aria-hidden="true"
          className="h-28 w-full rounded-xl bg-[linear-gradient(120deg,var(--primary),var(--surface-elevated)_45%,var(--surface))] opacity-70 sm:h-44"
        />

        <div className="flex flex-col gap-4 px-1 sm:flex-row sm:items-end sm:gap-6 sm:px-4">
          <div className="-mt-10 shrink-0 sm:-mt-16">{avatar}</div>

          <div className="flex min-w-0 flex-1 flex-col gap-1 pb-2">
            <h1
              id="channel-heading"
              className="text-2xl font-bold tracking-tight break-words text-foreground sm:text-4xl"
            >
              {channel.title}
            </h1>
            {subscribers === null ? null : (
              <p className="text-sm text-muted-foreground">{subscribers}</p>
            )}
          </div>

          <div className="pb-2">
            <a
              href={youtubeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              View on YouTube
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </div>
      </header>

      <ChannelTabs videos={uploadsSection} about={aboutSection} />
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
