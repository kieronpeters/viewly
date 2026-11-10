import "server-only";

import { cache } from "react";

import { getChannel } from "@/lib/youtube/client";
import type { ChannelDetail } from "@/shared/types";

/**
 * Reads one channel for the watch page's channel card (T74).
 *
 * Wrapped in React's `cache` so two slots in one render (today only the header,
 * later maybe the discussion) share a single `channels.list` request. The client
 * caches the normalized result for 24 h, so across requests one channel costs at
 * most one quota unit per day; this wrapper only removes duplicate work inside a
 * render.
 *
 * The id must already be validated by the caller; `getChannel` validates again
 * and throws on a malformed value, which `readWatchChannel` turns into a
 * fallback rather than an error.
 */
export const getWatchChannel = cache(async (channelId: string): Promise<ChannelDetail | null> => {
  return getChannel(channelId);
});
