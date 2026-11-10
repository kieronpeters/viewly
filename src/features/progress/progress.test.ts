import { describe, expect, it } from "vitest";

import { DomainValidationError } from "@/shared/validation";

import {
  COMPLETE_RATIO,
  PROGRESS_REPORT_INTERVAL_MS,
  RESUME_MIN_RATIO,
  isProgressComplete,
  isResumableProgress,
  parsePlaybackPosition,
  parsePlaybackProgress,
  progressFraction,
  progressFromRow,
  progressPercent,
  shouldReportProgress,
} from "./progress";

const VIDEO_ID = "dQw4w9WgXcQ";

describe("parsePlaybackProgress", () => {
  it("floors both second counts and keeps a valid position", () => {
    expect(parsePlaybackProgress(VIDEO_ID, 42.9, 213.8)).toEqual({
      videoId: VIDEO_ID,
      positionSeconds: 42,
      durationSeconds: 213,
    });
  });

  it("clamps a position past the end to the duration", () => {
    expect(parsePlaybackProgress(VIDEO_ID, 500, 213)).toMatchObject({
      positionSeconds: 213,
      durationSeconds: 213,
    });
  });

  it("accepts a position of zero (a video that has not played yet)", () => {
    expect(parsePlaybackProgress(VIDEO_ID, 0, 213).positionSeconds).toBe(0);
  });

  it.each([
    ["a malformed id", "too-short", 10, 100],
    ["a negative position", VIDEO_ID, -1, 100],
    ["a zero duration", VIDEO_ID, 10, 0],
    ["a fractional sub-second duration", VIDEO_ID, 10, 0.5],
    ["a NaN position", VIDEO_ID, Number.NaN, 100],
    ["an infinite duration", VIDEO_ID, 10, Number.POSITIVE_INFINITY],
    ["a string position", VIDEO_ID, "10", 100],
  ])("rejects %s", (_label, videoId, position, duration) => {
    expect(() => parsePlaybackProgress(videoId, position, duration)).toThrow(DomainValidationError);
  });
});

describe("parsePlaybackPosition", () => {
  it("validates the object payload used by future callers", () => {
    expect(parsePlaybackPosition({ positionSeconds: 30.7, durationSeconds: 120 })).toEqual({
      positionSeconds: 30,
      durationSeconds: 120,
    });
  });

  it("rejects a non-object payload", () => {
    expect(() => parsePlaybackPosition(null)).toThrow(DomainValidationError);
  });
});

describe("progress thresholds", () => {
  it("treats the 5% boundary as resumable", () => {
    expect(progressFraction(5, 100)).toBeCloseTo(RESUME_MIN_RATIO);
    expect(isResumableProgress(5, 100)).toBe(true);
    expect(isResumableProgress(4, 100)).toBe(false);
  });

  it("stops offering a resume prompt at 95%", () => {
    expect(isResumableProgress(94, 100)).toBe(true);
    expect(isResumableProgress(95, 100)).toBe(false);
    expect(isProgressComplete(95, 100)).toBe(true);
    expect(isProgressComplete(94, 100)).toBe(false);
  });

  it("never treats an unusable duration as progress or completion", () => {
    expect(progressFraction(10, 0)).toBe(0);
    expect(progressFraction(Number.NaN, 100)).toBe(0);
    expect(isResumableProgress(10, 0)).toBe(false);
    expect(isProgressComplete(10, 0)).toBe(false);
  });

  it("floors the bar width so 100% is reserved for a finished video", () => {
    expect(progressPercent(42, 100)).toBe(42);
    expect(progressPercent(42.9, 100)).toBe(42);
    expect(progressPercent(101, 100)).toBe(100);
    expect(COMPLETE_RATIO).toBe(0.95);
  });
});

describe("shouldReportProgress", () => {
  it("allows the first write", () => {
    expect(shouldReportProgress(null, 1_000)).toBe(true);
  });

  it("waits the full interval", () => {
    expect(shouldReportProgress(1_000, 1_000 + PROGRESS_REPORT_INTERVAL_MS - 1)).toBe(false);
    expect(shouldReportProgress(1_000, 1_000 + PROGRESS_REPORT_INTERVAL_MS)).toBe(true);
  });

  it("honours a custom interval", () => {
    expect(shouldReportProgress(1_000, 1_500, 500)).toBe(true);
    expect(shouldReportProgress(1_000, 1_499, 500)).toBe(false);
  });

  it("allows a write when the clock moved backwards", () => {
    expect(shouldReportProgress(2_000, 1_000)).toBe(true);
  });

  it("rejects a non-finite current time", () => {
    expect(shouldReportProgress(1_000, Number.NaN)).toBe(false);
  });
});

describe("progressFromRow", () => {
  it("serializes the timestamp as ISO-8601", () => {
    expect(
      progressFromRow({
        videoId: VIDEO_ID,
        positionSeconds: 42,
        durationSeconds: 213,
        updatedAt: new Date("2026-01-02T03:04:05Z"),
      }),
    ).toEqual({
      videoId: VIDEO_ID,
      positionSeconds: 42,
      durationSeconds: 213,
      updatedAt: "2026-01-02T03:04:05.000Z",
    });
  });
});
