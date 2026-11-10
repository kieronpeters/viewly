import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { ExpandableDescription } from "./expandable-description";
import { PlayerSeekProvider, usePlayerSeek } from "./player-seek";

/** Stand-in for the mounted watch player: records every requested seek. */
function SeekTarget({ onSeek }: { readonly onSeek: (seconds: number) => void }) {
  const playerSeek = usePlayerSeek();

  useEffect(() => {
    if (playerSeek === null) {
      return;
    }

    return playerSeek.registerSeekTarget(onSeek);
  }, [onSeek, playerSeek]);

  return null;
}

function renderWithPlayer(text: string, onSeek = vi.fn()) {
  const view = render(
    <PlayerSeekProvider>
      <SeekTarget onSeek={onSeek} />
      <ExpandableDescription text={text} />
    </PlayerSeekProvider>,
  );

  return { ...view, onSeek };
}

describe("ExpandableDescription timestamps", () => {
  it("renders each timestamp as a button, not a link", () => {
    renderWithPlayer("Start at 0:00, demo at 12:34, encore at 1:02:03.");

    expect(screen.getByRole("button", { name: "Seek to 0:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seek to 12:34" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seek to 1:02:03" })).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("seeks the player when a timestamp is clicked", async () => {
    const user = userEvent.setup();
    const { onSeek } = renderWithPlayer("Intro 0:00, demo 12:34, encore 1:02:03.");

    await user.click(screen.getByRole("button", { name: "Seek to 0:00" }));
    await user.click(screen.getByRole("button", { name: "Seek to 12:34" }));
    await user.click(screen.getByRole("button", { name: "Seek to 1:02:03" }));

    expect(onSeek.mock.calls).toEqual([[0], [754], [3_723]]);
  });

  it("does not navigate or create a destination for a timestamp", async () => {
    const user = userEvent.setup();
    const { container } = renderWithPlayer("Intro 0:00");

    const button = screen.getByRole("button", { name: "Seek to 0:00" });

    await user.click(button);

    // A plain button cannot navigate; no anchor or href is produced for it.
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toHaveAttribute("href");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("keeps the description text unchanged around timestamps", () => {
    const { container } = renderWithPlayer("Intro 0:00 then 12:34.");

    expect(container.querySelector('[data-slot="video-description"]')?.textContent).toBe(
      "Intro 0:00 then 12:34.",
    );
  });

  it("keeps T64 URL linkification and does not timestamp a URL", () => {
    renderWithPlayer("Docs https://example.com/watch?t=1:02 then 0:05");

    const link = screen.getByRole("link");

    expect(link).toHaveAttribute("href", "https://example.com/watch?t=1:02");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("button", { name: "Seek to 0:05" })).toBeInTheDocument();
    // The `1:02` inside the URL is part of the link, not a timestamp button.
    expect(screen.queryByRole("button", { name: "Seek to 1:02" })).not.toBeInTheDocument();
  });

  it("leaves unsafe text untouched next to a timestamp", () => {
    const { container } = renderWithPlayer("javascript:alert(1) 0:10 data:text/html,<b>x</b>");

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seek to 0:10" })).toBeInTheDocument();
  });

  it("renders no timestamp buttons when the description has none", () => {
    const { container } = renderWithPlayer("A description with no timestamps.");

    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("stays inert but visible outside a player", async () => {
    const user = userEvent.setup();

    render(<ExpandableDescription text="Intro 0:00" />);

    const button = screen.getByRole("button", { name: "Seek to 0:00" });

    await user.click(button);

    expect(button).toBeInTheDocument();
  });
});
