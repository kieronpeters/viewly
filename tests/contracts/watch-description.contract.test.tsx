import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ExpandableDescription } from "@/components/video/expandable-description";

/**
 * Contract for `docs/specs/watch-description.md`.
 *
 * Enforced behaviour only: every case here is something the shipped component
 * does today. The spec's deviations (clip height, no raw HTML) are recorded in
 * the parity report rather than asserted.
 */
function paragraph(container: HTMLElement): HTMLElement {
  const element = container.querySelector('[data-slot="video-description"]');

  if (!(element instanceof HTMLElement)) {
    throw new Error("expected the description paragraph");
  }

  return element;
}

describe("watch description contract", () => {
  it("renders the publisher text in the panel", () => {
    const { container } = render(<ExpandableDescription text="A short description." />);

    expect(paragraph(container).textContent).toBe("A short description.");
  });

  it("offers no toggle when the text fits", () => {
    render(<ExpandableDescription text="Short." />);

    expect(screen.queryByRole("button", { name: /show (more|less)/i })).toBeNull();
  });

  it("exposes Show more with aria-expanded and aria-controls, then toggles to Show less", async () => {
    const user = userEvent.setup();
    const longText = Array.from({ length: 40 }, (_, i) => `Line ${i} of a long description.`).join(
      " ",
    );

    render(<ExpandableDescription text={longText} />);

    const toggle = screen.getByRole("button", { name: "Show more" });

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls");

    await user.click(toggle);

    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("renders http(s) URLs as safe new-tab links", () => {
    render(<ExpandableDescription text="See https://example.com/docs for more." />);

    const link = screen.getByRole("link", { name: "https://example.com/docs" });

    expect(link).toHaveAttribute("href", "https://example.com/docs");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  });

  it("keeps unsafe schemes as text and never creates a link", () => {
    const { container } = render(
      <ExpandableDescription text="javascript:alert(1) data:text/html,<b>x</b>" />,
    );

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(paragraph(container).textContent).toContain("javascript:alert(1)");
  });
});
