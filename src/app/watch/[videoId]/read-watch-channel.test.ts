import { beforeEach, describe, expect, it, vi } from "vitest";

const { getWatchChannelMock } = vi.hoisted(() => ({ getWatchChannelMock: vi.fn() }));

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));
// The feature wrapper is server-only too; the read helper is what is under test.
vi.mock("@/features/video", () => ({ getWatchChannel: getWatchChannelMock }));

import type { ChannelDetail } from "@/shared/types";

import { readWatchChannel } from "./read-watch-channel";

const CHANNEL_ID = "UCuAXFkgsw1L7xaCfnd5JJOw";

const CHANNEL: ChannelDetail = {
  id: CHANNEL_ID,
  title: "Rick Astley",
  avatarUrl: null,
  subscriberCount: null,
  description: "",
  uploadsPlaylistId: null,
};

describe("readWatchChannel", () => {
  beforeEach(() => {
    getWatchChannelMock.mockReset();
  });

  it("returns the normalized channel", async () => {
    getWatchChannelMock.mockResolvedValue(CHANNEL);

    await expect(readWatchChannel(CHANNEL_ID)).resolves.toBe(CHANNEL);
    expect(getWatchChannelMock).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it("returns null when YouTube knows no such channel", async () => {
    getWatchChannelMock.mockResolvedValue(null);

    await expect(readWatchChannel(CHANNEL_ID)).resolves.toBeNull();
  });

  it("degrades every API failure to null so the page cannot break", async () => {
    for (const failure of [
      new Error("upstream exploded"),
      Object.assign(new Error("quota"), { code: "quota" }),
    ]) {
      getWatchChannelMock.mockRejectedValueOnce(failure);

      await expect(readWatchChannel(CHANNEL_ID)).resolves.toBeNull();
    }
  });

  it("does not call the API for an invalid channel id", async () => {
    for (const id of ["", "short", `UU${CHANNEL_ID.slice(2)}`]) {
      await expect(readWatchChannel(id)).resolves.toBeNull();
    }

    expect(getWatchChannelMock).not.toHaveBeenCalled();
  });
});
