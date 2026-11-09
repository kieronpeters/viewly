// @vitest-environment node
/**
 * Tests for the shared saved-video snapshot (T62).
 *
 * The thumbnail rule is a rendering contract, not only input hygiene:
 * `next/image` allows exactly the hosts in `next.config.ts`, and an off-host
 * `src` throws while a card renders, which takes the whole library tab down.
 * These tests pin both halves of the fix: what the parser accepts, and how a
 * row stored before the check is projected for display.
 */
import { describe, expect, it } from "vitest";

import { DomainValidationError } from "@/shared/validation";

import {
  THUMBNAIL_HOSTS,
  displayThumbnailUrl,
  fallbackThumbnailUrl,
  isAllowedThumbnailUrl,
  parseVideoSnapshot,
  type VideoSnapshot,
} from "./video-snapshot";

const VIDEO_ID = "dQw4w9WgXcQ";
const FALLBACK_THUMBNAIL = `https://i.ytimg.com/vi/${VIDEO_ID}/mqdefault.jpg`;

/** A complete, valid snapshot shaped like a normalized `search.list` item. */
const SNAPSHOT: VideoSnapshot = {
  videoId: VIDEO_ID,
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
  durationSeconds: 213,
};

describe("THUMBNAIL_HOSTS", () => {
  it("mirrors the hosts next/image is configured for", async () => {
    const { default: nextConfig } = await import("../../../next.config");
    const patterns = nextConfig.images?.remotePatterns ?? [];

    expect(patterns.map((pattern) => [pattern.protocol, pattern.hostname])).toEqual(
      THUMBNAIL_HOSTS.map((hostname) => ["https", hostname]),
    );
  });
});

describe("isAllowedThumbnailUrl", () => {
  it.each([
    ["i.ytimg.com", `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["img.youtube.com", `https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["yt3.ggpht.com", `https://yt3.ggpht.com/ytc/abc123=s88`],
  ])("accepts an https URL on %s", (_host, url) => {
    expect(isAllowedThumbnailUrl(url)).toBe(true);
  });

  it("accepts an uppercase host, which URL normalizes", () => {
    expect(isAllowedThumbnailUrl(`https://I.YTIMG.COM/vi/${VIDEO_ID}/hqdefault.jpg`)).toBe(true);
  });

  it.each([
    ["another https host", "https://example.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
    ["a lookalike subdomain", "https://i.ytimg.com.evil.example/vi/dQw4w9WgXcQ/hqdefault.jpg"],
    ["a parent domain", "https://ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
    ["plain http on an allowed host", `http://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["a non-default port", `https://i.ytimg.com:8443/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["a relative path", `/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["a non-URL", "not a url"],
  ])("rejects %s", (_label, url) => {
    expect(isAllowedThumbnailUrl(url)).toBe(false);
  });
});

describe("parseVideoSnapshot", () => {
  it.each([
    ["i.ytimg.com", `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["img.youtube.com", `https://img.youtube.com/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["yt3.ggpht.com", `https://yt3.ggpht.com/ytc/abc123=s88`],
  ])("accepts a thumbnail on %s", (_host, thumbnailUrl) => {
    expect(parseVideoSnapshot({ ...SNAPSHOT, thumbnailUrl })).toEqual({
      ...SNAPSHOT,
      thumbnailUrl,
    });
  });

  it("returns the URL exactly as supplied, without normalizing the host", () => {
    const thumbnailUrl = `https://I.YTIMG.COM/vi/${VIDEO_ID}/hqdefault.jpg`;

    expect(parseVideoSnapshot({ ...SNAPSHOT, thumbnailUrl }).thumbnailUrl).toBe(thumbnailUrl);
  });

  it.each([
    ["another https host", "https://example.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
    ["plain http on an allowed host", `http://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["a non-default port", `https://i.ytimg.com:8443/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["a non-URL", "not a url"],
  ])("rejects a thumbnail on %s", (_label, thumbnailUrl) => {
    try {
      parseVideoSnapshot({ ...SNAPSHOT, thumbnailUrl });
      expect.unreachable("parseVideoSnapshot should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainValidationError);
      expect((error as DomainValidationError).field).toBe("thumbnailUrl");
    }
  });
});

describe("fallbackThumbnailUrl", () => {
  it("is YouTube's public still on an allowed host", () => {
    expect(fallbackThumbnailUrl(VIDEO_ID)).toBe(FALLBACK_THUMBNAIL);
    expect(isAllowedThumbnailUrl(fallbackThumbnailUrl(VIDEO_ID))).toBe(true);
  });
});

describe("displayThumbnailUrl", () => {
  it("keeps a stored URL that next/image can render", () => {
    expect(displayThumbnailUrl(VIDEO_ID, SNAPSHOT.thumbnailUrl)).toBe(SNAPSHOT.thumbnailUrl);
  });

  it.each([
    ["another https host", "https://example.com/vi/dQw4w9WgXcQ/hqdefault.jpg"],
    ["plain http on an allowed host", `http://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`],
    ["a non-URL", "not a url"],
  ])("falls back to the canonical still for %s", (_label, thumbnailUrl) => {
    expect(displayThumbnailUrl(VIDEO_ID, thumbnailUrl)).toBe(FALLBACK_THUMBNAIL);
  });
});
