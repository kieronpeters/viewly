import { cn } from "@/lib/utils";
import { displayThumbnailUrl, type VideoSnapshot } from "@/features/library/video-snapshot";

export interface WatchAmbientBackdropProps {
  /** The same display snapshot the player and listen bar use. */
  snapshot: Pick<VideoSnapshot, "videoId" | "thumbnailUrl">;
  /** Optional positioning classes; the parent owns the layer's placement. */
  className?: string;
}

/**
 * Decorative ambient glow behind the watch player (T70).
 *
 * Reuses the stored thumbnail already in the display snapshot, so the ambient
 * layer never asks the API for another image. It is a plain `<img>` on purpose:
 * the URL is already a resolved, allowed CDN still and `next/image` fill would
 * need an intrinsic-size wrapper plus a second optimized request, both of which
 * are more machinery than a blurred decorative layer needs.
 *
 * The whole layer is `aria-hidden` and `pointer-events-none`: it is not content,
 * it cannot be focused, and it never intercepts a click meant for the player.
 * Opacity and blur are applied to the image only, using theme tokens for the
 * wash so no colour is hard-coded.
 */
export function WatchAmbientBackdrop({ snapshot, className }: WatchAmbientBackdropProps) {
  return (
    <div
      aria-hidden="true"
      data-slot="watch-ambient-backdrop"
      className={cn(
        "pointer-events-none absolute -inset-3 -z-10 select-none overflow-hidden rounded-3xl",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- see the component note */}
      <img
        src={displayThumbnailUrl(snapshot.videoId, snapshot.thumbnailUrl)}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        className="size-full scale-110 object-cover opacity-30 blur-3xl saturate-150"
      />
      <div className="absolute inset-0 bg-background/40" />
    </div>
  );
}
