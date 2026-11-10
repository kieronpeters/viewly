import { beforeEach, describe, expect, it, vi } from "vitest";

const { getChannelMock, listPlaylistItemsMock } = vi.hoisted(() => ({
  getChannelMock: vi.fn(),
  listPlaylistItemsMock: vi.fn(),
}));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/youtube/client", () => ({
  getChannel: getChannelMock,
  listPlaylistItems: listPlaylistItemsMock,
}));

import type { ChannelDetail, VideoSummary } from "@/shared/types";

import { CHANNEL_UPLOAD_LIMIT, readChannel } from "./read-channel";

const CHANNEL_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";
const UPLOADS_PLAYLIST_ID = "UUuAXFkgsw1L7xaCfnd5JJOw";

const CHANNEL: ChannelDetail = {
  id: CHANNEL_ID,
  title: "Rick Astley",
  avatarUrl: null,
  subscriberCount: null,
  description: "The official Rick Astley channel.",
  uploadsPlaylistId: UPLOADS_PLAYLIST_ID,
};

const UPLOAD: VideoSummary = {
  id: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up",
  channelId: CHANNEL_ID,
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  publishedAt: "2009-10-25T06:57:33Z",
  durationSeconds: null,
  viewCount: null,
};

describe("readChannel", () => {
  beforeEach(() => {
    getChannelMock.mockReset();
    listPlaylistItemsMock.mockReset();
  });

  it("returns the channel and its recent uploads", async () => {
    getChannelMock.mockResolvedValue(CHANNEL);
    listPlaylistItemsMock.mockResolvedValue([UPLOAD]);

    await expect(readChannel(CHANNEL_ID)).resolves.toEqual({
      status: "ok",
      channel: CHANNEL,
      uploads: [UPLOAD],
      uploadsUnavailable: false,
    });
    expect(getChannelMock).toHaveBeenCalledWith(CHANNEL_ID);
    expect(listPlaylistItemsMock).toHaveBeenCalledWith({
      playlistId: UPLOADS_PLAYLIST_ID,
      maxResults: CHANNEL_UPLOAD_LIMIT,
    });
    expect(CHANNEL_UPLOAD_LIMIT).toBe(25);
  });

  it("reports an empty uploads page as a normal result", async () => {
    getChannelMock.mockResolvedValue(CHANNEL);
    listPlaylistItemsMock.mockResolvedValue([]);

    const read = await readChannel(CHANNEL_ID);

    expect(read).toEqual({
      status: "ok",
      channel: CHANNEL,
      uploads: [],
      uploadsUnavailable: false,
    });
  });

  it("rejects an invalid id before any request", async () => {
    for (const id of ["", "short", `UU${CHANNEL_ID.slice(2)}`]) {
      await expect(readChannel(id)).resolves.toEqual({ status: "not_found" });
    }

    expect(getChannelMock).not.toHaveBeenCalled();
    expect(listPlaylistItemsMock).not.toHaveBeenCalled();
  });

  it("maps a missing channel to not_found without reading uploads", async () => {
    getChannelMock.mockResolvedValue(null);

    await expect(readChannel(CHANNEL_ID)).resolves.toEqual({ status: "not_found" });
    expect(listPlaylistItemsMock).not.toHaveBeenCalled();
  });

  it("maps every channel lookup failure to a retryable error", async () => {
    for (const failure of [
      new Error("upstream exploded"),
      Object.assign(new Error("quota"), { code: "quota" }),
    ]) {
      getChannelMock.mockRejectedValueOnce(failure);

      await expect(readChannel(CHANNEL_ID)).resolves.toEqual({ status: "error" });
    }

    expect(listPlaylistItemsMock).not.toHaveBeenCalled();
  });

  it("keeps the channel when the uploads call fails", async () => {
    getChannelMock.mockResolvedValue(CHANNEL);
    listPlaylistItemsMock.mockRejectedValue(new Error("quota exceeded"));

    await expect(readChannel(CHANNEL_ID)).resolves.toEqual({
      status: "ok",
      channel: CHANNEL,
      uploads: [],
      uploadsUnavailable: true,
    });
  });

  it("marks uploads unavailable when YouTube publishes no uploads playlist id", async () => {
    getChannelMock.mockResolvedValue({ ...CHANNEL, uploadsPlaylistId: null });

    const read = await readChannel(CHANNEL_ID);

    expect(read).toEqual({
      status: "ok",
      channel: { ...CHANNEL, uploadsPlaylistId: null },
      uploads: [],
      uploadsUnavailable: true,
    });
    expect(listPlaylistItemsMock).not.toHaveBeenCalled();
  });
});
