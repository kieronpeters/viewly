import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { WatchShortcutsOverlay } from "./watch-shortcuts-overlay";

/** A page with a real opener so focus return can be observed. */
function Harness() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Keyboard shortcuts
      </button>
      <WatchShortcutsOverlay open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

describe("WatchShortcutsOverlay", () => {
  it("renders nothing while closed", () => {
    render(<WatchShortcutsOverlay open={false} onClose={() => {}} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled modal dialog that lists the shortcuts", () => {
    render(<WatchShortcutsOverlay open onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });

    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription(/while you are typing/i);
    expect(screen.getByText("Play or pause")).toBeInTheDocument();
    expect(screen.getByText("Back 10 seconds")).toBeInTheDocument();
    expect(screen.getByText("Theater mode")).toBeInTheDocument();
    expect(screen.getByText("Close this panel")).toBeInTheDocument();
    // The rows use real <kbd> elements, not just styled text.
    expect(dialog.querySelectorAll("kbd").length).toBeGreaterThan(0);
  });

  it("moves focus into the dialog on open and returns it to the opener on Escape", async () => {
    const user = userEvent.setup();

    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Keyboard shortcuts" });

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });

    expect(dialog).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("closes from the close button and returns focus", async () => {
    const user = userEvent.setup();

    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Keyboard shortcuts" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close keyboard shortcuts" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveFocus();
  });

  it("keeps Tab inside the dialog", async () => {
    const user = userEvent.setup();

    render(<WatchShortcutsOverlay open onClose={() => {}} />);

    const close = screen.getByRole("button", { name: "Close keyboard shortcuts" });
    // The only control is the close button: Tab and Shift+Tab both stay on it.
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });
});
