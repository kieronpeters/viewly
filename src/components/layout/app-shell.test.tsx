import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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
});
