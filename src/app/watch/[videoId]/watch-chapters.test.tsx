import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";

import { PlayerSeekProvider, usePlayerSeek } from "@/components/video/player-seek";

import { WatchChapters } from "./watch-chapters";

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

function renderChapters(text: string, onSeek = vi.fn()) {
  const view = render(
    <PlayerSeekProvider>
      <SeekTarget onSeek={onSeek} />
      <WatchChapters text={text} />
    </PlayerSeekProvider>,
  );

  return { ...view, onSeek };
}

describe("WatchChapters", () => {
  it("lists chapters ordered by time, whatever the description order", () => {
    renderChapters("12:34 Demo\n0:00 Intro\n1:02:03 Encore");

    const list = screen.getByRole("list");
    const items = within(list).getAllByRole("listitem");

    expect(items.map((item) => item.querySelector("button")?.dataset.seconds)).toEqual([
      "0",
      "754",
      "3723",
    ]);
  });

  it("labels the list with a Chapters heading", () => {
    renderChapters("0:00 Intro\n12:34 Demo");

    expect(screen.getByRole("heading", { name: "Chapters", level: 3 })).toBeInTheDocument();
  });

  it("seeks when a chapter is clicked", async () => {
    const user = userEvent.setup();
    const { onSeek } = renderChapters("0:00 Intro\n12:34 Demo\n1:02:03 Encore");

    await user.click(screen.getByRole("button", { name: "12:34 Demo" }));
    await user.click(screen.getByRole("button", { name: "1:02:03 Encore" }));

    expect(onSeek.mock.calls).toEqual([[754], [3_723]]);
  });

  it("renders buttons rather than navigating links", () => {
    const { container } = renderChapters("0:00 Intro\n12:34 Demo");

    expect(container.querySelectorAll("a")).toHaveLength(0);

    for (const button of screen.getAllByRole("button")) {
      expect(button).toHaveAttribute("type", "button");
      expect(button).not.toHaveAttribute("href");
    }
  });

  it("keeps a bare timestamp usable without inventing a title", () => {
    renderChapters("0:00\n12:34");

    expect(screen.getByRole("button", { name: "0:00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "12:34" })).toBeInTheDocument();
  });

  it("collapses a repeated timestamp to one chapter", () => {
    renderChapters("0:00 Intro\n12:34 Demo\n0:00 Intro again");

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders nothing with no timestamps", () => {
    const { container } = renderChapters("A description with no chapter marks.");

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders nothing with only one timestamp", () => {
    const { container } = renderChapters("0:00 Intro");

    expect(container).toBeEmptyDOMElement();
  });

  it("ignores unsafe text and URL timestamps", () => {
    const { container } = renderChapters("javascript:alert(1) https://example.com/watch?t=1:02");

    expect(container).toBeEmptyDOMElement();
  });
});
