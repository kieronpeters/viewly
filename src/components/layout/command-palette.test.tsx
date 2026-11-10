import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { CommandPalette } from "./command-palette";

beforeEach(() => {
  push.mockReset();
});

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Control>}k{/Control}");

  return screen.getByRole("combobox", { name: "Search commands and pages" });
}

describe("CommandPalette", () => {
  it("renders nothing and runs nothing while closed", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");

    render(<CommandPalette />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();

    await user.keyboard("{Enter}{ArrowDown}");

    expect(push).not.toHaveBeenCalled();
    expect(writeText).not.toHaveBeenCalled();
  });

  it("opens with Ctrl+K and moves focus into the combobox", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    const input = await openPalette(user);

    const dialog = screen.getByRole("dialog", { name: "Command palette" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/arrow keys/i);
    expect(input).toHaveFocus();
    expect(screen.getByRole("listbox", { name: "Commands" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Home" })).toHaveAttribute("aria-selected", "true");
  });

  it("also opens with Cmd+K", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    await user.keyboard("{Meta>}k{/Meta}");

    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search commands and pages" })).toHaveFocus();
  });

  it("closes on Escape and returns focus to the opener", async () => {
    const user = userEvent.setup();

    render(
      <div>
        <button type="button">Open from here</button>
        <CommandPalette />
      </div>,
    );

    const opener = screen.getByRole("button", { name: "Open from here" });

    opener.focus();
    expect(opener).toHaveFocus();

    await openPalette(user);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener).toHaveFocus();
  });

  it("filters on titles and keywords and drops commands that do not match", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    const input = await openPalette(user);

    await user.type(input, "history");

    const options = screen.getAllByRole("option");

    expect(options[0]).toHaveAccessibleName("History");
    expect(screen.queryByRole("option", { name: "Home" })).toBeNull();
    expect(screen.getByRole("option", { name: "Stats" })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "queue");

    expect(screen.getAllByRole("option")[0]).toHaveAccessibleName("Watch later");
  });

  it("moves the visible highlight with the arrow keys", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    const input = await openPalette(user);
    const home = screen.getByRole("option", { name: "Home" });
    const search = screen.getByRole("option", { name: "Search" });

    expect(home).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowDown}");
    expect(search).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", search.id);

    await user.keyboard("{ArrowUp}");
    expect(home).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("option", { name: "Copy current page link" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("navigates to the highlighted command with Enter and closes", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    await openPalette(user);
    await user.keyboard("{ArrowDown}{Enter}");

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/search");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("turns typed text into a search navigation", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    const input = await openPalette(user);

    await user.type(input, "cats");
    await user.keyboard("{Enter}");

    expect(push).toHaveBeenCalledWith("/search?q=cats");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();

    render(<CommandPalette />);

    const input = await openPalette(user);
    const close = screen.getByRole("button", { name: "Close command palette" });

    expect(input).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();

    await user.tab();
    expect(input).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it("copies the current page link and announces the result", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    render(<CommandPalette />);

    const input = await openPalette(user);

    await user.type(input, "copy");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent("Current page link copied to clipboard.");
    expect(push).not.toHaveBeenCalled();
  });

  it("reports a clipboard failure without closing", async () => {
    const user = userEvent.setup();

    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    render(<CommandPalette />);

    const input = await openPalette(user);

    await user.type(input, "copy");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not copy the current page link."),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
