import { isEnvConfigurationError } from "@/lib/env";
import { getWatchVideo } from "@/features/video";
import type { VideoDetail } from "@/shared/types";

/**
 * Outcome of reading one video for the watch route.
 *
 * A missing key is a deploy-time state the page can explain, so it is modelled
 * as a return value instead of an exception. Everything else keeps throwing so
 * the route's error boundary still owns genuine failures.
 */
export type WatchVideoRead =
  { status: "ok"; video: VideoDetail | null } | { status: "configuration_error" };

/**
 * Single guarded call to `getWatchVideo`.
 *
 * Both `generateMetadata` and the page body read through here, so the keyless
 * case is caught in one place and no `EnvConfigurationError` reaches Next's dev
 * overlay, the error boundary or the rendered HTML. The error value itself is
 * never returned: the caller only learns *that* configuration is missing, never
 * its message, stack or the key.
 */
export async function readWatchVideo(videoId: string): Promise<WatchVideoRead> {
  try {
    return { status: "ok", video: await getWatchVideo(videoId) };
  } catch (error) {
    if (isEnvConfigurationError(error)) {
      return { status: "configuration_error" };
    }

    throw error;
  }
}
