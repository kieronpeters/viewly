import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The account slot is an async Server Component and the search form reads the
// router; both are stubbed so the shell renders as a client tree.
vi.mock("@/components/layout/account-menu", () => ({
  AccountMenu: () => <span>Sign in</span>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

import { AppShell } from "@/components/layout/app-shell";

function renderShell() {
  return render(
    <AppShell>
      <p>Page content</p>
    </AppShell>,
  );
}

/**
 * Contract for `docs/specs/system.md`: the cross-cutting landmark, focus and
 * motion guarantees every route inherits.
 */
describe("system contract: landmarks and focus", () => {
  it("exposes exactly one main landmark that the skip link targets", () => {
    renderShell();

    const main = screen.getByRole("main");

    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveAttribute("tabindex", "-1");
  });

  it("puts the skip link first in the focus order", () => {
    const { container } = renderShell();

    const skip = screen.getByRole("link", { name: /skip to content/i });
    const focusables = container.querySelectorAll<HTMLElement>(
      'a[href], button, [tabindex]:not([tabindex="-1"])',
    );

    expect(skip).toHaveAttribute("href", "#main-content");
    expect(focusables[0]).toBe(skip);
  });

  it("reduces motion globally when the OS preference asks for it", () => {
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms/);
  });
});
