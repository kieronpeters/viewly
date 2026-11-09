import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toggleWatchLaterMock } = vi.hoisted(() => ({ toggleWatchLaterMock: vi.fn() }));

// The real action is a server reference; the component contract is what is
// under test here, so the action is replaced with a controllable promise.
vi.mock("@/features/library/actions", () => ({ toggleWatchLater: toggleWatchLaterMock }));

import { WatchLaterButton } from "./watch-later-button";
import type { WatchLaterSnapshot } from "@/features/library/watch-later-toggle";

/** A complete snapshot shaped like a normalized `search.list` item. */
const SNAPSHOT: WatchLaterSnapshot = {
  videoId: "dQw4w9WgXcQ",
  title: "Never Gonna Give You Up (Official Video)",
  channelTitle: "Rick Astley",
  thumbnailUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
  durationSeconds: 213,
};

/** A promise whose settlement the test controls, for observing optimistic state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  toggleWatchLaterMock.mockReset();
});

describe("WatchLaterButton", () => {
  it("reflects the server-read state and exposes aria-pressed", () => {
    render(<WatchLaterButton video={SNAPSHOT} initialInWatchLater={false} />);

    const button = screen.getByRole("button", { name: "Add to Watch Later" });

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("type", "button");
  });

  it("renders the queued state as a remove action", () => {
    render(<WatchLaterButton video={SNAPSHOT} initialInWatchLater />);

    expect(screen.getByRole("button", { name: "Remove from Watch Later" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("toggles optimistically before the action resolves, then keeps the server result", async () => {
    const gate = deferred<{ inWatchLater: boolean }>();
    toggleWatchLaterMock.mockReturnValue(gate.promise);

    const user = userEvent.setup();
    render(<WatchLaterButton video={SNAPSHOT} initialInWatchLater={false} />);

    const button = screen.getByRole("button", { name: "Add to Watch Later" });

    await user.click(button);

    // Optimistic: the label and pressed state flip while the action is pending.
    expect(toggleWatchLaterMock).toHaveBeenCalledTimes(1);
    expect(toggleWatchLaterMock).toHaveBeenCalledWith(SNAPSHOT);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAccessibleName("Remove from Watch Later");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();

    await act(async () => {
      gate.resolve({ inWatchLater: true });
      await gate.promise;
    });

    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("applies the action result when it disagrees with the optimistic flip", async () => {
    // For example, another tab already queued the video, so the server toggled
    // it off: the control must follow SQLite, not its own optimistic guess.
    toggleWatchLaterMock.mockResolvedValue({ inWatchLater: false });

    const user = userEvent.setup();
    render(<WatchLaterButton video={SNAPSHOT} initialInWatchLater={false} />);

    const button = screen.getByRole("button", { name: "Add to Watch Later" });

    await user.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Add to Watch Later");
  });

  it("rolls the optimistic update back and shows an inline error on failure", async () => {
    const gate = deferred<{ inWatchLater: boolean }>();
    toggleWatchLaterMock.mockReturnValue(gate.promise);

    const user = userEvent.setup();
    render(<WatchLaterButton video={SNAPSHOT} initialInWatchLater={false} />);

    const button = screen.getByRole("button", { name: "Add to Watch Later" });

    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      gate.reject(new Error("offline"));
    });

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Could not update Watch Later");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Add to Watch Later");
    expect(button).toBeEnabled();
  });

  it("turns a queued video off optimistically", async () => {
    const gate = deferred<{ inWatchLater: boolean }>();
    toggleWatchLaterMock.mockReturnValue(gate.promise);

    const user = userEvent.setup();
    render(<WatchLaterButton video={SNAPSHOT} initialInWatchLater />);

    const button = screen.getByRole("button", { name: "Remove from Watch Later" });

    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Add to Watch Later");

    await act(async () => {
      gate.resolve({ inWatchLater: false });
      await gate.promise;
    });

    await waitFor(() => expect(button).toBeEnabled());
  });

  it("keeps a 44px touch target and a visible focus ring", () => {
    render(<WatchLaterButton video={SNAPSHOT} initialInWatchLater={false} />);

    const button = screen.getByRole("button", { name: "Add to Watch Later" });

    expect(button).toHaveClass("min-h-11", "min-w-11");
    expect(button).toHaveClass("focus-visible:ring-2");
  });
});
