import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Query string for the embed.
 *
 * `rel=0` keeps the end screen on the same channel instead of pulling in
 * unrelated recommendations. Nothing else is needed: autoplay stays off and
 * YouTube's own defaults apply for captions and quality.
 */
const EMBED_QUERY = "rel=0";

export interface YoutubePlayerProps {
  /** Normalized 11-character YouTube id; never a raw route segment. */
  videoId: string;
  /** Video title, used verbatim in the iframe's accessible name. */
  title: string;
  /** Optional wrapper classes; page layout stays with the parent. */
  className?: string;
}

/**
 * Official YouTube embed for `/watch/[videoId]`.
 *
 * Playback is the real YouTube iframe: no media is proxied or downloaded, and
 * YouTube keeps ownership of its controls, captions and fullscreen behaviour.
 * `youtube-nocookie.com` avoids advertising cookies until the viewer starts
 * playback. A third-party embed can still be blocked (extensions, consent
 * walls, network policy), so a plain link to the watch page is always visible
 * beside the player.
 */
export function YoutubePlayer({ videoId, title, className }: YoutubePlayerProps) {
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${EMBED_QUERY}`;
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  return (
    <div data-slot="youtube-player" className={cn("flex min-w-0 flex-col gap-2", className)}>
      {/*
        The wrapper owns the 16:9 box, so the space is reserved before the
        iframe loads and the page never shifts. The iframe fills it absolutely.
      */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
        <iframe
          src={embedUrl}
          title={`${title} — YouTube video player`}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 size-full border-0"
        />
      </div>

      <a
        href={watchUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 w-fit items-center gap-1.5 self-start rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ExternalLink aria-hidden="true" className="size-4" />
        Open on YouTube
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}
