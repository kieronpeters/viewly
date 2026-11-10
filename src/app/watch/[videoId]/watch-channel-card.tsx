import { CircleUserRound, ExternalLink } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { formatSubscriberCount } from "@/shared/format";
import type { ChannelDetail } from "@/shared/types";
import { isChannelId } from "@/shared/validation";

/** Generic label used when neither the channel nor the video snippet names it. */
const UNNAMED_CHANNEL = "Channel";

export interface WatchChannelCardProps {
  /**
   * Normalized `channels.list` result, or null when the lookup failed or the
   * channel is unavailable. Null never hides the card: the snippet values and a
   * drawn avatar take over.
   */
  channel: ChannelDetail | null;
  /** Channel name from the video snippet; the fallback label. */
  channelTitle: string;
  /** Video id; the outbound link falls back to the video when no channel is known. */
  videoId: string;
  /**
   * Channel id from the video snippet. Used for the internal `/channel/[id]`
   * link even when `channels.list` failed, so the channel page stays reachable.
   * Invalid or absent values simply omit that link.
   */
  channelId?: string;
}

/**
 * The channel identity in the watch header (T74): avatar, name and one outbound
 * link, replacing the plain channel text.
 *
 * Deliberately a pure Server Component with no fetching: `WatchPageContent`
 * reads the channel through the guarded `readWatchChannel`, so a YouTube failure
 * arrives here as `channel: null` and never as an exception.
 *
 * Fallbacks, in order:
 * - avatar: `channels.list` thumbnail, else the channel's first letter, else the
 *   drawn `CircleUserRound` icon the header used before this card existed;
 * - name: channel title, else the video snippet's `channelTitle`, else "Channel";
 * - outbound link: the channel page when the API returned the channel,
 *   otherwise the video's own YouTube URL, which is guaranteed to exist on this
 *   route;
 * - internal link: the channel name points at `/channel/[id]` whenever a valid
 *   channel id is known, independent of whether `channels.list` succeeded.
 *
 * The subscriber count is rendered only when `channels.list` published one; a
 * hidden or absent count leaves the line out instead of showing zero. The row is
 * `min-w-0` with a truncating name so it fits a 390px viewport, and the outbound
 * link is a 44px target like the controls beside it.
 */
export function WatchChannelCard({
  channel,
  channelTitle,
  videoId,
  channelId,
}: WatchChannelCardProps) {
  const name = firstNonEmpty([channel?.title, channelTitle]) ?? UNNAMED_CHANNEL;
  const initial = firstCharacter(name);
  const subscribers = formatSubscriberCount(channel?.subscriberCount ?? null);
  const internalChannelId = channel?.id ?? (isChannelId(channelId) ? channelId : null);
  const href =
    channel === null
      ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
      : `https://www.youtube.com/channel/${encodeURIComponent(channel.id)}`;

  return (
    <div data-slot="watch-channel-card" className="flex min-w-0 max-w-full items-center gap-3">
      {channel?.avatarUrl != null ? (
        <Image
          src={channel.avatarUrl}
          alt=""
          width={40}
          height={40}
          className="size-10 shrink-0 rounded-full border border-border bg-surface object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-sm font-semibold text-muted-foreground"
        >
          {initial ?? <CircleUserRound className="size-6" />}
        </span>
      )}

      <div className="flex min-w-0 flex-col">
        <p className="min-w-0 truncate text-sm font-medium text-foreground">
          {internalChannelId === null ? (
            <>
              <span className="sr-only">Channel: </span>
              {name}
            </>
          ) : (
            <Link
              href={`/channel/${encodeURIComponent(internalChannelId)}`}
              className="block truncate rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="sr-only">Channel: </span>
              {name}
            </Link>
          )}
        </p>
        {subscribers !== null ? (
          <p className="truncate text-xs text-muted-foreground">{subscribers}</p>
        ) : null}
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ExternalLink aria-hidden="true" className="size-3.5" />
          View on YouTube
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}

/** First trimmed, non-empty candidate, or null when every candidate is blank. */
function firstNonEmpty(candidates: readonly (string | undefined)[]): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? "";
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

/** First code point of a name, upper-cased, or null when there is none. */
function firstCharacter(name: string): string | null {
  const [first] = Array.from(name);
  return first === undefined ? null : first.toUpperCase();
}
