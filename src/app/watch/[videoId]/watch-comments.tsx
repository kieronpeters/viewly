"use client";

import { ExternalLink, MessageSquare } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui";
import { formatPublishedDate } from "@/components/video/format-published-date";
import { formatCount } from "@/shared/format";
import type { CommentPage, VideoComment } from "@/shared/types";
import { isRecord } from "@/shared/validation";

/** Comments requested per page. Small enough that "Load more" stays cheap. */
const PAGE_SIZE = 20;

/** Where the panel is in its request lifecycle. */
type CommentsStatus = "loading" | "ready" | "error";

/**
 * Read-only comments for the watch page's Comments tab (T80).
 *
 * The panel is deliberately isolated from the rest of the watch page: it fetches
 * its own page from `/api/videos/[id]/comments` after mount, so a quota error, a
 * disabled-comments response or a broken upstream can never throw during the
 * page render or take the player down with it. The API key stays on the server.
 *
 * States the UI distinguishes:
 *
 * - loading: a quiet status line, nothing announced as content;
 * - ready with comments: author, text, likes, publish date and reply count,
 *   plus "Load more comments" while YouTube supplies another page token;
 * - ready with no comments: an authored empty state;
 * - comments disabled: an authored "turned off" state, not an error;
 * - error: authored copy with a retry button, never upstream detail;
 * - load-more error: the existing list stays, with an inline retry.
 *
 * Comment text is rendered as a React text node (`whitespace-pre-line`), never
 * as HTML. It lives only in component state and the server's five-minute cache.
 */
export interface WatchCommentsProps {
  /** The video whose comments are listed. */
  videoId: string;
}

export function WatchComments({ videoId }: WatchCommentsProps) {
  const [status, setStatus] = useState<CommentsStatus>("loading");
  const [items, setItems] = useState<VideoComment[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [commentsDisabled, setCommentsDisabled] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);

  /** The initial request's controller: replaced on retry, aborted on unmount. */
  const initialRequest = useRef<AbortController | null>(null);

  /** Applies a settled first page. Kept separate so the effect never sets state synchronously. */
  const applyFirstPage = useCallback((page: CommentPage) => {
    setItems(page.items);
    setNextPageToken(page.nextPageToken);
    setCommentsDisabled(page.commentsDisabled);
    setStatus("ready");
  }, []);

  const applyFirstPageError = useCallback((error: unknown) => {
    setErrorMessage(describeCommentsError(error));
    setStatus("error");
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    initialRequest.current = controller;

    // State changes happen in the promise callbacks, not in the effect body.
    requestComments(videoId, null, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) {
          applyFirstPage(page);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          applyFirstPageError(error);
        }
      },
    );

    return () => {
      controller.abort();
    };
  }, [applyFirstPage, applyFirstPageError, videoId]);

  const retry = useCallback(() => {
    // A retry supersedes any earlier in-flight attempt.
    initialRequest.current?.abort();
    const controller = new AbortController();
    initialRequest.current = controller;

    setStatus("loading");
    setErrorMessage("");
    setLoadMoreFailed(false);

    requestComments(videoId, null, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) {
          applyFirstPage(page);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          applyFirstPageError(error);
        }
      },
    );
  }, [applyFirstPage, applyFirstPageError, videoId]);

  const loadMore = useCallback(async () => {
    if (nextPageToken === null || isLoadingMore) {
      return;
    }

    setIsLoadingMore(true);
    setLoadMoreFailed(false);

    try {
      const page = await requestComments(videoId, nextPageToken);
      // YouTube can repeat a thread across pages; de-duplicate by comment id so
      // React keys and the reader's place in the list stay stable.
      setItems((current) => mergeComments(current, page.items));
      setNextPageToken(page.nextPageToken);
    } catch {
      setLoadMoreFailed(true);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, nextPageToken, videoId]);

  if (status === "loading") {
    return <CommentsSkeleton />;
  }

  if (status === "error") {
    return (
      <div className="flex flex-col items-center gap-1">
        <ErrorState title="Comments could not load" message={errorMessage} onRetry={retry} />
        <CommentOnYoutubeLink videoId={videoId} />
      </div>
    );
  }

  if (commentsDisabled) {
    return (
      <EmptyState
        title="Comments are turned off"
        message="The channel has disabled comments for this video. You can still join the conversation on YouTube."
        icon={<MessageSquare aria-hidden="true" className="size-6" />}
        action={<CommentOnYoutubeLink videoId={videoId} />}
        className="px-2"
      />
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No comments yet"
        message="Be the first to comment on this video on YouTube."
        icon={<MessageSquare aria-hidden="true" className="size-6" />}
        action={<CommentOnYoutubeLink videoId={videoId} />}
        className="px-2"
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-sm font-semibold text-foreground">Comments</h2>
        <CommentOnYoutubeLink videoId={videoId} />
      </div>

      <ul role="list" className="flex min-w-0 flex-col divide-y divide-border">
        {items.map((comment) => (
          <CommentItem key={comment.id} comment={comment} />
        ))}
      </ul>

      {nextPageToken === null ? null : (
        <div className="flex flex-col items-center gap-2 pt-1">
          {loadMoreFailed ? (
            <p role="alert" className="text-sm text-muted-foreground">
              Could not load more comments. Please try again.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={loadMore}
            disabled={isLoadingMore}
            className="min-h-11"
          >
            {isLoadingMore ? "Loading comments…" : "Load more comments"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** One top-level comment. Text is plain text; no upstream markup is rendered. */
function CommentItem({ comment }: { comment: VideoComment }) {
  const publishedAt = formatPublishedDate(comment.publishedAt);
  const likeCount =
    comment.likeCount !== null && comment.likeCount > 0 ? formatCount(comment.likeCount) : null;
  const replyCount = comment.replyCount > 0 ? formatCount(comment.replyCount) : null;

  return (
    <li className="flex min-w-0 flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="min-w-0 text-sm font-medium break-words text-foreground">{comment.author}</p>
        {publishedAt === null ? null : (
          <time dateTime={comment.publishedAt} className="text-xs text-muted-foreground">
            {publishedAt}
          </time>
        )}
      </div>

      <p className="text-sm leading-relaxed break-words whitespace-pre-line text-foreground">
        {comment.text}
      </p>

      {likeCount === null && replyCount === null ? null : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          {likeCount === null ? null : (
            <span>
              {likeCount} {comment.likeCount === 1 ? "like" : "likes"}
            </span>
          )}
          {likeCount !== null && replyCount !== null ? <span aria-hidden="true">·</span> : null}
          {replyCount === null ? null : (
            <span>
              {replyCount} {comment.replyCount === 1 ? "reply" : "replies"}
            </span>
          )}
        </p>
      )}
    </li>
  );
}

/** Outbound link shown in every ready state, including disabled and empty. */
function CommentOnYoutubeLink({ videoId }: { videoId: string }) {
  return (
    <a
      href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ExternalLink aria-hidden="true" className="size-3.5" />
      Comment on YouTube
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** Quiet placeholder: no heading, so a later empty state never contradicts it. */
function CommentsSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3 px-2 py-3">
      <span className="sr-only">Loading comments…</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Failure raised by the panel's own fetch, carrying only a stable code. */
class CommentsRequestError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`Comments request failed: ${code}`);
    this.name = "CommentsRequestError";
    this.code = code;
  }
}

/**
 * Fetches one page of comments. The response is the app's own route, so the
 * envelope is stable; any malformed body is still treated as a failure rather
 * than cast into the UI.
 */
async function requestComments(
  videoId: string,
  pageToken: string | null,
  signal?: AbortSignal,
): Promise<CommentPage> {
  const url = new URL(
    `/api/videos/${encodeURIComponent(videoId)}/comments`,
    window.location.origin,
  );
  url.searchParams.set("maxResults", String(PAGE_SIZE));
  if (pageToken !== null) {
    url.searchParams.set("pageToken", pageToken);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (signal?.aborted === true) {
      throw error;
    }

    throw new CommentsRequestError("network");
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new CommentsRequestError(readErrorCode(payload) ?? "unexpected");
  }

  const page = readCommentPage(payload);
  if (page === null) {
    throw new CommentsRequestError("unexpected");
  }

  return page;
}

function readErrorCode(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return null;
  }

  const code = payload.error.code;
  return typeof code === "string" ? code : null;
}

/** Minimal runtime shape check for the app's own `CommentPage` response. */
function readCommentPage(payload: unknown): CommentPage | null {
  if (!isRecord(payload) || !Array.isArray(payload.items)) {
    return null;
  }

  const token = payload.nextPageToken;
  if (token !== undefined && token !== null && typeof token !== "string") {
    return null;
  }

  const items: VideoComment[] = [];
  for (const rawItem of payload.items) {
    const comment = readComment(rawItem);
    if (comment !== null) {
      items.push(comment);
    }
  }

  return {
    items,
    nextPageToken: typeof token === "string" ? token : null,
    commentsDisabled: payload.commentsDisabled === true,
  };
}

function readComment(value: unknown): VideoComment | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, author, text, publishedAt } = value;
  if (
    typeof id !== "string" ||
    typeof author !== "string" ||
    typeof text !== "string" ||
    typeof publishedAt !== "string"
  ) {
    return null;
  }

  const likeCount = readCount(value.likeCount);
  if (likeCount === undefined) {
    return null;
  }

  return {
    id,
    author,
    text,
    publishedAt,
    likeCount,
    replyCount: readCount(value.replyCount) ?? 0,
  };
}

/** `undefined` means malformed; `null` means the source omitted the count. */
function readCount(value: unknown): number | null | undefined {
  if (value === null || value === undefined) {
    return null;
  }

  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/**
 * Authored copy per stable code. The raw envelope message is never rendered:
 * the route already keeps it safe, and this keeps the invariant local too.
 */
function describeCommentsError(error: unknown): string {
  const code = error instanceof CommentsRequestError ? error.code : "unexpected";

  switch (code) {
    case "RATE_LIMITED":
      return "Comments are unavailable right now because the YouTube API quota has been reached. Please try again later.";
    case "CONFIGURATION_ERROR":
      return "Comments are unavailable because the server is not configured for YouTube right now.";
    case "UPSTREAM_ERROR":
      return "YouTube could not load comments right now. Please try again in a moment.";
    case "network":
      return "Could not reach the comments service. Check your connection and try again.";
    default:
      return "Something went wrong while loading comments. Please try again.";
  }
}

/**
 * Appends a page, keeping first-seen order and dropping repeated ids. YouTube
 * pagination is not transactional; a new comment can shift a thread onto the
 * next page and produce an overlap.
 */
function mergeComments(
  current: readonly VideoComment[],
  incoming: readonly VideoComment[],
): VideoComment[] {
  const seen = new Set(current.map((comment) => comment.id));
  const merged = [...current];

  for (const comment of incoming) {
    if (!seen.has(comment.id)) {
      seen.add(comment.id);
      merged.push(comment);
    }
  }

  return merged;
}
