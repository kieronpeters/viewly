import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

import { AppShell } from "@/components/layout/app-shell";

describe("AppShell brand link", () => {
  it("gives the sidebar and mobile home links the accessible name Viewly home", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    const homeLinks = screen.getAllByRole("link", { name: "Viewly home" });

    expect(homeLinks).toHaveLength(2);

    for (const link of homeLinks) {
      expect(link).toHaveAttribute("href", "/");
      expect(link.querySelector("svg")).not.toBeNull();
    }
  });

  it("keeps the logo decorative inside the named link", () => {
    const { container } = render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    for (const link of container.querySelectorAll<HTMLAnchorElement>(
      'a[aria-label="Viewly home"]',
    )) {
      expect(link.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("mounts exactly one command palette for the whole shell", async () => {
    const user = userEvent.setup();

    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    await user.keyboard("{Control>}k{/Control}");

    expect(screen.getAllByRole("dialog", { name: "Command palette" })).toHaveLength(1);
  });

  it("mounts one player host but no player while nothing is selected", () => {
    render(
      <AppShell>
        <p>Page content</p>
      </AppShell>,
    );

    // The shell owns the player (T75), but a route that never picked a video
    // must not create an iframe or surface.
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector('[data-slot="player-surface"]')).toBeNull();
    expect(screen.queryByRole("region", { name: "Mini player" })).toBeNull();
  });
});
