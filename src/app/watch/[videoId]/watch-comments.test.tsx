import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CommentPage, VideoComment } from "@/shared/types";

import { WatchComments } from "./watch-comments";

const VIDEO_ID = "dQw4w9WgXcQ";

const COMMENT: VideoComment = {
  id: "UgxComment",
  author: "Ada Lovelace",
  text: "First! Great video.",
  likeCount: 1200,
  publishedAt: "2026-01-02T03:04:05Z",
  replyCount: 3,
};

function page(overrides: Partial<CommentPage> = {}): CommentPage {
  return {
    items: [COMMENT],
    nextPageToken: null,
    commentsDisabled: false,
    ...overrides,
  };
}

const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse(
    { error: { code, message: "Upstream detail that must not render." } },
    status,
  );
}

function requestedUrl(callIndex = 0): URL {
  const call = fetchMock.mock.calls[callIndex];
  if (call === undefined) {
    throw new Error(`Expected fetch call #${callIndex}.`);
  }

  const [input] = call;
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WatchComments", () => {
  it("shows a quiet loading state until the first page arrives", () => {
    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));

    render(<WatchComments videoId={VIDEO_ID} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading comments…");
    expect(screen.queryByRole("heading", { name: "Comments" })).not.toBeInTheDocument();
  });

  it("fetches the panel's own endpoint with the page size", async () => {
    fetchMock.mockResolvedValue(jsonResponse(page()));

    render(<WatchComments videoId={VIDEO_ID} />);

    await screen.findByText(COMMENT.text);

    const url = requestedUrl();
    expect(url.pathname).toBe(`/api/videos/${VIDEO_ID}/comments`);
    expect(url.searchParams.get("maxResults")).toBe("20");
    expect(url.searchParams.has("pageToken")).toBe(false);
  });

  it("renders author, text, likes, date and reply count", async () => {
    fetchMock.mockResolvedValue(jsonResponse(page()));

    render(<WatchComments videoId={VIDEO_ID} />);

    const list = await screen.findByRole("list");
    expect(within(list).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(list).getByText("First! Great video.")).toBeInTheDocument();
    expect(within(list).getByText("1.2K likes")).toBeInTheDocument();
    expect(within(list).getByText("3 replies")).toBeInTheDocument();
    expect(within(list).getByText("2 Jan 2026")).toBeInTheDocument();
  });

  it("renders comment text as text, never as markup", async () => {
    const hostile: VideoComment = { ...COMMENT, text: "<b>Hello</b> <img src=x onerror=alert(1)>" };
    fetchMock.mockResolvedValue(jsonResponse(page({ items: [hostile] })));

    const { container } = render(<WatchComments videoId={VIDEO_ID} />);

    await screen.findByText(hostile.text);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("shows an empty state and the outbound link when there are no comments", async () => {
    fetchMock.mockResolvedValue(jsonResponse(page({ items: [] })));

    render(<WatchComments videoId={VIDEO_ID} />);

    expect(await screen.findByText("No comments yet")).toBeInTheDocument();
    expect(screen.getByText(/be the first to comment/i)).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /comment on youtube/i });
    expect(link).toHaveAttribute("href", `https://www.youtube.com/watch?v=${VIDEO_ID}`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("shows a dedicated state when comments are disabled", async () => {
    fetchMock.mockResolvedValue(jsonResponse(page({ items: [], commentsDisabled: true })));

    render(<WatchComments videoId={VIDEO_ID} />);

    expect(await screen.findByText("Comments are turned off")).toBeInTheDocument();
    expect(screen.getByText(/disabled comments for this video/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /comment on youtube/i })).toBeInTheDocument();
    // Disabled is not an error: no alert region and no retry.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("maps quota failures to authored copy and retries on demand", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse("RATE_LIMITED", 429))
      .mockResolvedValueOnce(jsonResponse(page()));

    const user = userEvent.setup();
    render(<WatchComments videoId={VIDEO_ID} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/quota/i);
    expect(alert).not.toHaveTextContent("Upstream detail");
    expect(screen.getByRole("link", { name: /comment on youtube/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText(COMMENT.text)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["UPSTREAM_ERROR", 502, /could not load comments/i],
    ["CONFIGURATION_ERROR", 500, /not configured/i],
  ])("maps %s to authored copy", async (code, status, expected) => {
    fetchMock.mockResolvedValue(errorResponse(code, status));

    render(<WatchComments videoId={VIDEO_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
    expect(screen.getByRole("alert")).not.toHaveTextContent("Upstream detail");
  });

  it("treats a network failure as an error state, not a crash", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    render(<WatchComments videoId={VIDEO_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/check your connection/i);
  });

  it("treats a malformed response body as an error state", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ items: "nope" }));

    render(<WatchComments videoId={VIDEO_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
  });

  it("loads another page, appends it, and hides the button at the end", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(
          page({
            items: [COMMENT],
            nextPageToken: "PAGE_2",
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          page({
            items: [
              COMMENT,
              { ...COMMENT, id: "UgxSecond", author: "Grace Hopper", text: "Second page." },
            ],
            nextPageToken: null,
          }),
        ),
      );

    const user = userEvent.setup();
    render(<WatchComments videoId={VIDEO_ID} />);

    await screen.findByText(COMMENT.text);
    await user.click(screen.getByRole("button", { name: "Load more comments" }));

    expect(await screen.findByText("Second page.")).toBeInTheDocument();
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(requestedUrl(1).searchParams.get("pageToken")).toBe("PAGE_2");
    // The repeated first comment is de-duplicated.
    expect(screen.getAllByText(COMMENT.text)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Load more comments" })).not.toBeInTheDocument();
  });

  it("keeps loaded comments and offers a retry when loading more fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(page({ nextPageToken: "PAGE_2" })))
      .mockResolvedValueOnce(errorResponse("UPSTREAM_ERROR", 502))
      .mockResolvedValueOnce(
        jsonResponse(
          page({
            items: [{ ...COMMENT, id: "UgxSecond", author: "Grace Hopper", text: "Second page." }],
            nextPageToken: null,
          }),
        ),
      );

    const user = userEvent.setup();
    render(<WatchComments videoId={VIDEO_ID} />);

    await screen.findByText(COMMENT.text);
    await user.click(screen.getByRole("button", { name: "Load more comments" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load more comments/i);
    expect(screen.getByText(COMMENT.text)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Load more comments" }));

    expect(await screen.findByText("Second page.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
