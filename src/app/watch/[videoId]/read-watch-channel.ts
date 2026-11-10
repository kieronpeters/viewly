import { getWatchChannel } from "@/features/video";
import type { ChannelDetail } from "@/shared/types";
import { isChannelId } from "@/shared/validation";

/**
 * Optional channel metadata for the watch page's channel card (T74).
 *
 * Two reasons this never throws, unlike {@link readWatchVideo}:
 *
 * - The channel card is an enhancement. The player, title, description and
 *   actions must render even when `channels.list` fails with quota, auth,
 *   transport or a malformed payload, so a failure degrades to `null` and the
 *   card draws its initial avatar and keeps a working outbound link.
 * - A video snippet can carry an unusual `channelId` (YouTube is not contractually
 *   bound to the `UC…` shape). An id that fails validation is simply not looked
 *   up, which also guarantees no malformed id ever reaches the network.
 *
 * The caller already has the channel name and id from `videos.list`, so `null`
 * here means "use the snippet values", not "no channel".
 */
export async function readWatchChannel(channelId: string): Promise<ChannelDetail | null> {
  if (!isChannelId(channelId)) {
    return null;
  }

  try {
    return await getWatchChannel(channelId);
  } catch {
    // Deliberately swallowed: no upstream message, URL or key can reach the
    // page, and the card has an authored fallback for every shape of failure.
    return null;
  }
}
