import { assertVideoId } from "@/shared/validation";

/**
 * Route-param guard for `/watch/[videoId]`.
 *
 * Returns the normalized id, or null when the URL segment is not a valid
 * 11-character YouTube id. `assertVideoId` remains the single source of truth
 * for the format; this wrapper only converts its throw into a branch so the
 * route can call `notFound()` instead of surfacing a validation error as a 500.
 */
export function parseWatchVideoId(value: unknown): string | null {
  try {
    return assertVideoId(value);
  } catch {
    return null;
  }
}
