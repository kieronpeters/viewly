import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ViewlyLogo } from "@/components/brand/viewly-logo";

describe("ViewlyLogo", () => {
  it("renders a decorative mark and wordmark", () => {
    const { container } = render(<ViewlyLogo />);

    const svg = container.querySelector("svg");

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 24 24");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Viewly")).toBeInTheDocument();
    // The lockup is decorative; the link around it owns the accessible name.
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("paints the mark from the Midnight Purple tokens", () => {
    const { container } = render(<ViewlyLogo />);

    expect(container.querySelector("svg")).toHaveClass("text-primary");
    expect(container.querySelector("path")).toHaveClass("fill-primary-foreground");
  });

  it("renders fixed square sizes so the header cannot shift", () => {
    const { container, rerender } = render(<ViewlyLogo size="sm" />);

    expect(container.querySelector("svg")).toHaveClass("size-6");

    rerender(<ViewlyLogo size="md" />);
    expect(container.querySelector("svg")).toHaveClass("size-8");

    rerender(<ViewlyLogo size="lg" />);
    expect(container.querySelector("svg")).toHaveClass("size-10");
  });

  it("can drop the wordmark for the mark-only lockup", () => {
    render(<ViewlyLogo markOnly />);

    expect(screen.queryByText("Viewly")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
