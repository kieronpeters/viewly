import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { toggleFavouriteMock } = vi.hoisted(() => ({ toggleFavouriteMock: vi.fn() }));

// The real action is a server reference; the component contract is what is
// under test here, so the action is replaced with a controllable promise.
vi.mock("@/features/library/actions", () => ({ toggleFavourite: toggleFavouriteMock }));

import { FavouriteButton } from "./favourite-button";
import type { FavouriteSnapshot } from "@/features/library/favourite-toggle";

/** A complete snapshot shaped like a normalized `search.list` item. */
const SNAPSHOT: FavouriteSnapshot = {
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
  toggleFavouriteMock.mockReset();
});

describe("FavouriteButton", () => {
  it("reflects the server-read state and exposes aria-pressed", () => {
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const button = screen.getByRole("button", { name: "Add to favourites" });

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("type", "button");
  });

  it("renders the saved state as a remove action", () => {
    render(<FavouriteButton video={SNAPSHOT} initialFavourite />);

    expect(screen.getByRole("button", { name: "Remove from favourites" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("toggles optimistically before the action resolves, then keeps the server result", async () => {
    const gate = deferred<{ favourited: boolean }>();
    toggleFavouriteMock.mockReturnValue(gate.promise);

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const button = screen.getByRole("button", { name: "Add to favourites" });

    await user.click(button);

    // Optimistic: the label and pressed state flip while the action is pending.
    expect(toggleFavouriteMock).toHaveBeenCalledTimes(1);
    expect(toggleFavouriteMock).toHaveBeenCalledWith(SNAPSHOT);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAccessibleName("Remove from favourites");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();

    await act(async () => {
      gate.resolve({ favourited: true });
      await gate.promise;
    });

    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("applies the action result when it disagrees with the optimistic flip", async () => {
    // For example, another tab already saved the video, so the server toggled
    // it off: the control must follow SQLite, not its own optimistic guess.
    toggleFavouriteMock.mockResolvedValue({ favourited: false });

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const button = screen.getByRole("button", { name: "Add to favourites" });

    await user.click(button);

    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Add to favourites");
  });

  it("rolls the optimistic update back and shows an inline error on failure", async () => {
    const gate = deferred<{ favourited: boolean }>();
    toggleFavouriteMock.mockReturnValue(gate.promise);

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const button = screen.getByRole("button", { name: "Add to favourites" });

    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      gate.reject(new Error("offline"));
    });

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("Could not update favourites");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Add to favourites");
    expect(button).toBeEnabled();
  });

  it("turns a saved favourite off optimistically", async () => {
    const gate = deferred<{ favourited: boolean }>();
    toggleFavouriteMock.mockReturnValue(gate.promise);

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite />);

    const button = screen.getByRole("button", { name: "Remove from favourites" });

    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAccessibleName("Add to favourites");

    await act(async () => {
      gate.resolve({ favourited: false });
      await gate.promise;
    });

    await waitFor(() => expect(button).toBeEnabled());
  });

  it("keeps a 44px touch target and a visible focus ring", () => {
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const button = screen.getByRole("button", { name: "Add to favourites" });

    expect(button).toHaveClass("min-h-11", "min-w-11");
    expect(button).toHaveClass("focus-visible:ring-2");
  });

  it("toggles with Enter when reached by keyboard", async () => {
    toggleFavouriteMock.mockResolvedValue({ favourited: true });

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    await user.tab();
    const button = screen.getByRole("button", { name: "Add to favourites" });
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => expect(button).toBeEnabled());
    expect(toggleFavouriteMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles with Space when reached by keyboard", async () => {
    toggleFavouriteMock.mockResolvedValue({ favourited: false });

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite />);

    await user.tab();
    const button = screen.getByRole("button", { name: "Remove from favourites" });
    expect(button).toHaveFocus();

    await user.keyboard(" ");

    await waitFor(() => expect(button).toBeEnabled());
    expect(toggleFavouriteMock).toHaveBeenCalledTimes(1);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("ignores a second press while the first is still pending", async () => {
    const gate = deferred<{ favourited: boolean }>();
    toggleFavouriteMock.mockReturnValue(gate.promise);

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const button = screen.getByRole("button", { name: "Add to favourites" });
    await user.click(button);

    expect(button).toBeDisabled();
    await user.click(button);
    await user.keyboard("{Enter}");

    expect(toggleFavouriteMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve({ favourited: true });
      await gate.promise;
    });

    await waitFor(() => expect(button).toBeEnabled());
  });

  it("clears the inline error when a later attempt succeeds", async () => {
    toggleFavouriteMock
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ favourited: true });

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const button = screen.getByRole("button", { name: "Add to favourites" });

    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update favourites");

    await user.click(button);

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(toggleFavouriteMock).toHaveBeenCalledTimes(2);
  });

  it("confirms a save in a polite live region instead of a toast", async () => {
    toggleFavouriteMock.mockResolvedValue({ favourited: true });

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    const region = screen.getByRole("status");

    // The region is mounted empty: the save has not happened yet, so there is
    // nothing to announce and the control has not moved.
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "Add to favourites" }));

    await waitFor(() => expect(region).toHaveTextContent("Added to favourites."));
    // Non-blocking: the message never captures pointer events, and it is placed
    // out of flow by the caller so it cannot shift the card grid.
    expect(region).toHaveClass("pointer-events-none");
    expect(region.parentElement).toHaveClass("relative");
    expect(region).toHaveClass("absolute");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("confirms turning a saved favourite off", async () => {
    toggleFavouriteMock.mockResolvedValue({ favourited: false });

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite />);

    await user.click(screen.getByRole("button", { name: "Remove from favourites" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Removed from favourites."),
    );
  });

  it("uses the action result, not the optimistic guess, in its confirmation", async () => {
    // Another tab already saved the video, so the server toggles it off.
    toggleFavouriteMock.mockResolvedValue({ favourited: false });

    const user = userEvent.setup();
    render(<FavouriteButton video={SNAPSHOT} initialFavourite={false} />);

    await user.click(screen.getByRole("button", { name: "Add to favourites" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Removed from favourites."),
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Added to favourites.");
  });
});
