import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside a Server Component graph; Vitest is not one.
vi.mock("server-only", () => ({}));

// The rail is a Client Component with the App Router's navigation hook; this
// suite only exercises its server-side fetch/filter output.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// No network: only `searchVideos` is replaced, so the real error class and its
// stable codes are exercised for real.
vi.mock("@/lib/youtube/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube/client")>();
  return { ...actual, searchVideos: vi.fn() };
});

// The rail rows do not render save controls, but the module graph still reaches
// the library actions; they stay inert here.
vi.mock("@/features/library/actions", () => ({
  toggleFavourite: vi.fn(),
  toggleWatchLater: vi.fn(),
}));
vi.mock("@/features/library/playlist-actions", () => ({
  createPlaylist: vi.fn(),
  renamePlaylist: vi.fn(),
  deletePlaylist: vi.fn(),
  addToPlaylist: vi.fn(),
  removeFromPlaylist: vi.fn(),
}));

import { YouTubeApiError, searchVideos } from "@/lib/youtube/client";
import type { SearchPage, VideoSummary } from "@/shared/types";

import { WatchSuggestions } from "./watch-suggestions";

const CURRENT_ID = "currentVid1";

const searchVideosMock = vi.mocked(searchVideos);

/** Hand-written fixture shaped like a normalized `search.list` item. */
function summary(id: string, overrides: Partial<VideoSummary> = {}): VideoSummary {
  return {
    id,
    title: `Video ${id}`,
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    channelTitle: "Rick Astley",
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    publishedAt: "2009-10-25T06:57:33Z",
    durationSeconds: 213,
    viewCount: 1_500_000,
    ...overrides,
  };
}

function page(items: VideoSummary[]): SearchPage {
  return { items, nextPageToken: null, totalResults: items.length };
}

/** Resolves the async Server Component, then renders its output. */
async function renderSuggestions(channelTitle = "Rick Astley") {
  const element = await WatchSuggestions({ channelTitle, currentVideoId: CURRENT_ID });
  return render(<>{element}</>);
}

beforeEach(() => {
  searchVideosMock.mockReset();
});

describe("WatchSuggestions", () => {
  it("renders candidates as compact rows that link to the watch page", async () => {
    searchVideosMock.mockResolvedValue(page([summary("aaaaaaaaaaa"), summary("bbbbbbbbbbb")]));

    const { container } = await renderSuggestions();

    const section = screen.getByRole("region", { name: "Up next" });
    expect(within(section).getByText(/suggested by viewly/i)).toBeInTheDocument();

    const firstLink = within(section).getByRole("link", { name: /Video aaaaaaaaaaa/ });
    expect(firstLink).toHaveAttribute("href", "/watch/aaaaaaaaaaa");
    expect(within(firstLink).getByText("Video aaaaaaaaaaa")).toBeInTheDocument();

    expect(within(section).getAllByRole("link")).toHaveLength(2);
    expect(container.querySelector('[data-slot="up-next-row"]')).not.toBeNull();
    expect(within(firstLink).getByText("3:33")).toBeInTheDocument();
    expect(within(firstLink).getByText("1.5M views")).toBeInTheDocument();
  });

  it("asks the client for the channel title, capped at eight", async () => {
    searchVideosMock.mockResolvedValue(page([summary("aaaaaaaaaaa")]));

    await renderSuggestions("Rick Astley");

    expect(searchVideosMock).toHaveBeenCalledWith({ query: "Rick Astley", maxResults: 8 });
  });

  it("excludes the current video and de-duplicates by id", async () => {
    searchVideosMock.mockResolvedValue(
      page([
        summary(CURRENT_ID),
        summary("aaaaaaaaaaa"),
        summary("aaaaaaaaaaa"),
        summary("bbbbbbbbbbb"),
      ]),
    );

    const { container } = await renderSuggestions();

    const links = within(screen.getByRole("region", { name: "Up next" })).getAllByRole("link");

    expect(links).toHaveLength(2);
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/watch/aaaaaaaaaaa",
      "/watch/bbbbbbbbbbb",
    ]);
    expect(container.querySelector(`a[href="/watch/${CURRENT_ID}"]`)).toBeNull();
  });

  it("caps the rendered rows at eight", async () => {
    searchVideosMock.mockResolvedValue(
      page(
        Array.from({ length: 12 }, (_, index) =>
          summary(`suggest${String(index).padStart(4, "0")}`),
        ),
      ),
    );

    await renderSuggestions();

    const section = screen.getByRole("region", { name: "Up next" });
    expect(within(section).getAllByRole("link")).toHaveLength(8);
  });

  it("renders nothing when the search returns no candidates", async () => {
    searchVideosMock.mockResolvedValue(page([]));

    const { container } = await renderSuggestions();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "Up next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing when the only candidate is the current video", async () => {
    searchVideosMock.mockResolvedValue(page([summary(CURRENT_ID)]));

    const { container } = await renderSuggestions();

    expect(container).toBeEmptyDOMElement();
  });

  it("hides on a client error without leaking the request URL or key", async () => {
    // A worst-case upstream message: a URL that carries the API key. The
    // section must swallow the failure, not render it.
    searchVideosMock.mockRejectedValue(
      new YouTubeApiError(
        "network",
        "Could not reach https://www.googleapis.com/youtube/v3/search?key=SECRET_KEY_123",
      ),
    );

    const { container } = await renderSuggestions();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("region", { name: "Up next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SECRET_KEY_123");
    expect(document.body.textContent).not.toContain("googleapis.com");
  });

  it("hides on an unexpected error too", async () => {
    searchVideosMock.mockRejectedValue(new Error("boom"));

    const { container } = await renderSuggestions();

    expect(container).toBeEmptyDOMElement();
    expect(document.body.textContent).not.toContain("boom");
  });
});
