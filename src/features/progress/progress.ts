/**
 * Client-safe core of local playback progress (T68).
 *
 * Holds the shared shape, the validation used by the Server Action and the pure
 * helpers the player and the cards use to decide whether a stored position is
 * worth resuming or showing.
 *
 * This module deliberately has **no runtime dependency** on the database layer:
 * `VideoProgressRow` is imported as a type only, so a Client Component may
 * import these helpers without pulling `better-sqlite3` (or the `server-only`
 * guard) into the browser bundle. The server-only entry points live in
 * `progress-data.ts` (reads) and `actions.ts` (mutations).
 *
 * ## Thresholds
 *
 * A position is resumable from 5% up to (but not including) 95% of the video.
 * Below 5% the viewer barely started, so a prompt would be noise; at 95% the
 * video is effectively finished, so the row is cleared instead of resumed. The
 * same two thresholds drive the card progress bar, so a bar and a prompt never
 * disagree.
 */
import type { VideoProgressRow } from "@/lib/db/repositories/progress.repository";
import { DomainValidationError, assertVideoId, isRecord } from "@/shared/validation";

/** Below this fraction of the duration, progress is not worth resuming. */
export const RESUME_MIN_RATIO = 0.05;

/** At or above this fraction, the video counts as finished and progress is cleared. */
export const COMPLETE_RATIO = 0.95;

/**
 * Minimum gap between two progress writes while playing.
 *
 * The player polls the IFrame API on this interval, and the Server Action
 * re-checks it in `shouldReportProgress`, so a burst of ticks (or a paused then
 * resumed player) can never write more often than this.
 */
export const PROGRESS_REPORT_INTERVAL_MS = 5_000;

/** A stored playback position as it crosses the Server Action / RSC boundary. */
export interface VideoProgress {
  /** YouTube video id. */
  videoId: string;
  /** Last reported position in whole seconds. */
  positionSeconds: number;
  /** Total duration in whole seconds. */
  durationSeconds: number;
  /** Last write time, ISO-8601, for `<time dateTime>` and diagnostics. */
  updatedAt: string;
}

/** The minimum a progress bar needs; independent of storage. */
export interface PlaybackPosition {
  positionSeconds: number;
  durationSeconds: number;
}

/**
 * Validates an untrusted position pair and normalizes it for storage.
 *
 * `position` must be a finite, non-negative number and `duration` a finite
 * positive number. Both are floored because the schema stores whole seconds,
 * and the position is clamped to the duration so a seek past the end cannot
 * make a progress bar overflow. Fractions are accepted because the IFrame API
 * reports `getCurrentTime()` as a float.
 */
export function parsePlaybackProgress(
  videoId: unknown,
  position: unknown,
  duration: unknown,
): { videoId: string; positionSeconds: number; durationSeconds: number } {
  const id = assertVideoId(videoId);
  const durationSeconds = parseSeconds(duration, "duration", { allowZero: false });
  const positionSeconds = Math.min(
    parseSeconds(position, "position", { allowZero: true }),
    durationSeconds,
  );

  return { videoId: id, positionSeconds, durationSeconds };
}

/** Validates an untrusted object payload shaped like {@link PlaybackPosition}. */
export function parsePlaybackPosition(input: unknown): PlaybackPosition {
  if (!isRecord(input)) {
    throw new DomainValidationError(
      "malformed_payload",
      "Playback progress must be an object with a position and duration.",
    );
  }

  const durationSeconds = parseSeconds(input.durationSeconds, "durationSeconds", {
    allowZero: false,
  });
  const positionSeconds = Math.min(
    parseSeconds(input.positionSeconds, "positionSeconds", { allowZero: true }),
    durationSeconds,
  );

  return { positionSeconds, durationSeconds };
}

/** Shared numeric check for the two second counts. */
function parseSeconds(value: unknown, field: string, options: { allowZero: boolean }): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainValidationError("invalid_format", `${field} must be a finite number.`, {
      field,
    });
  }

  if (value < 0 || (!options.allowZero && value < 1)) {
    throw new DomainValidationError(
      "invalid_format",
      options.allowZero ? `${field} must not be negative.` : `${field} must be positive.`,
      { field },
    );
  }

  return Math.floor(value);
}

/**
 * Playback fraction in `[0, 1]`, or `0` when the duration is unusable.
 *
 * Never throws: an unknown duration (`0`, `NaN`, `Infinity`) is treated as "no
 * progress" so a card or prompt simply does not render.
 */
export function progressFraction(positionSeconds: number, durationSeconds: number): number {
  if (
    !Number.isFinite(positionSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    positionSeconds <= 0
  ) {
    return 0;
  }

  return Math.min(positionSeconds / durationSeconds, 1);
}

/** Whether a stored position should offer "Resume from m:ss". */
export function isResumableProgress(positionSeconds: number, durationSeconds: number): boolean {
  const fraction = progressFraction(positionSeconds, durationSeconds);

  return fraction >= RESUME_MIN_RATIO && fraction < COMPLETE_RATIO;
}

/** Whether playback has reached the point where progress is cleared. */
export function isProgressComplete(positionSeconds: number, durationSeconds: number): boolean {
  return progressFraction(positionSeconds, durationSeconds) >= COMPLETE_RATIO;
}

/** Whole-percent width for a progress bar, rounded down so 100% means finished. */
export function progressPercent(positionSeconds: number, durationSeconds: number): number {
  return Math.floor(progressFraction(positionSeconds, durationSeconds) * 100);
}

/**
 * Throttle decision for the player's write loop.
 *
 * `true` when no write has happened yet, or when at least `intervalMs` has
 * passed since the last one. A clock that moves backwards (`now < last`) also
 * allows the write, so a suspended laptop or a test with a reset clock is not
 * stuck without progress.
 */
export function shouldReportProgress(
  lastReportedAt: number | null,
  now: number,
  intervalMs: number = PROGRESS_REPORT_INTERVAL_MS,
): boolean {
  if (lastReportedAt === null || !Number.isFinite(lastReportedAt)) {
    return true;
  }

  if (!Number.isFinite(now)) {
    return false;
  }

  return now - lastReportedAt >= intervalMs || now < lastReportedAt;
}

/** Maps a repository row to the serializable shape the UI stores. */
export function progressFromRow(row: VideoProgressRow): VideoProgress {
  return {
    videoId: row.videoId,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds,
    updatedAt: row.updatedAt.toISOString(),
  };
}
