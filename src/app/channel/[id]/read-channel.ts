import { getChannel, listPlaylistItems } from "@/lib/youtube/client";
import type { ChannelDetail, VideoSummary } from "@/shared/types";
import { isChannelId } from "@/shared/validation";

/** Number of recent uploads shown on a channel page. */
export const CHANNEL_UPLOAD_LIMIT = 25;

/** Outcome of reading one channel for `/channel/[id]`. */
export type ChannelRead =
  | {
      status: "ok";
      /** Normalized `channels.list` item; never null on this branch. */
      channel: ChannelDetail;
      /** Recent uploads, newest first. Empty when the channel has none. */
      uploads: VideoSummary[];
      /**
       * True when the uploads grid could not be read (quota, transport or a
       * missing uploads playlist id). The channel header still renders; the
       * uploads section shows a retryable error.
       */
      uploadsUnavailable: boolean;
    }
  /** The id is malformed or YouTube returned no channel for it. */
  | { status: "not_found" }
  /** The channel lookup itself failed (quota, auth, transport, malformed payload). */
  | { status: "error" };

/**
 * Reads everything `/channel/[id]` renders, without letting an upstream failure
 * escape as an exception.
 *
 * - A malformed id or an empty `channels.list` result is `not_found`, which the
 *   route turns into its segment 404.
 * - A failed `channels.list` is `error`: the channel may exist, so calling it a
 *   404 would be misleading. The page renders an authored retry state instead.
 * - A failed `playlistItems.list` is not fatal. The channel header is already
 *   known, so `uploadsUnavailable` is set and the grid shows its own error. The
 *   same applies when YouTube returns no uploads playlist id.
 *
 * Invalid ids are rejected before any request. Both client calls are cached
 * (`channels` 24 h, `playlistItems` 10 min), so a metadata read in the same
 * request does not spend quota twice.
 */
export async function readChannel(channelId: string): Promise<ChannelRead> {
  if (!isChannelId(channelId)) {
    return { status: "not_found" };
  }

  let channel: ChannelDetail | null;
  try {
    channel = await getChannel(channelId);
  } catch {
    // Deliberately swallowed: no upstream message, URL or key reaches the page.
    return { status: "error" };
  }

  if (channel === null) {
    return { status: "not_found" };
  }

  if (channel.uploadsPlaylistId === null) {
    return { status: "ok", channel, uploads: [], uploadsUnavailable: true };
  }

  try {
    const uploads = await listPlaylistItems({
      playlistId: channel.uploadsPlaylistId,
      maxResults: CHANNEL_UPLOAD_LIMIT,
    });

    return { status: "ok", channel, uploads, uploadsUnavailable: false };
  } catch {
    return { status: "ok", channel, uploads: [], uploadsUnavailable: true };
  }
}
