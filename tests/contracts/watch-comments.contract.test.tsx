import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WatchDiscussionTabs } from "@/app/watch/[videoId]/watch-discussion-tabs";

// Both panels are exercised by their own suites; this contract is the tab
// widget and the containment boundary, so the panels are stubbed.
vi.mock("@/app/watch/[videoId]/watch-comments", () => ({
  WatchComments: () => <div data-testid="comments-panel">comments</div>,
}));
vi.mock("@/app/watch/[videoId]/watch-notes", () => ({
  WatchNotes: () => <div data-testid="notes-panel">notes</div>,
}));

function renderTabs() {
  return render(<WatchDiscussionTabs videoId="dQw4w9WgXcQ" initialNotes={[]} />);
}

describe("watch comments contract", () => {
  it("renders a tablist with exactly the two section tabs", () => {
    renderTabs();

    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist).getAllByRole("tab");

    expect(tabs.map((tab) => tab.textContent)).toEqual(["Comments", "Your notes"]);
  });

  it("selects Comments on load and keeps both panels mounted", () => {
    renderTabs();

    expect(screen.getByRole("tab", { name: "Comments" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Your notes" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(screen.getByTestId("comments-panel")).toBeInTheDocument();
    expect(screen.getByTestId("notes-panel")).toBeInTheDocument();
  });

  it("wires every tab to its panel with aria-controls and aria-labelledby", () => {
    renderTabs();

    const tab = screen.getByRole("tab", { name: "Comments" });
    const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");

    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });

  it("moves selection with arrow keys and Home/End", async () => {
    const user = userEvent.setup();

    renderTabs();

    const comments = screen.getByRole("tab", { name: "Comments" });

    comments.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("tab", { name: "Your notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Comments" })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Your notes" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("switching tabs only toggles the panel, keeping both alive", async () => {
    const user = userEvent.setup();

    renderTabs();

    await user.click(screen.getByRole("tab", { name: "Your notes" }));

    expect(screen.getByTestId("notes-panel")).toBeVisible();
    expect(screen.getByTestId("comments-panel")).not.toBeVisible();
  });
});
