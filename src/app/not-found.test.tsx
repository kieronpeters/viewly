import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound, { metadata } from "./not-found";

/** The complete title a metadata export resolves to, independent of its shape. */
function resolveTitle(value: typeof metadata.title): string | null {
  if (typeof value === "string") {
    return value;
  }

  return value !== null && typeof value === "object" && "absolute" in value ? value.absolute : null;
}

describe("not-found metadata", () => {
  it("sets the document title to Page not found · Viewly", () => {
    expect(resolveTitle(metadata.title)).toBe("Page not found · Viewly");
  });
});

describe("NotFound", () => {
  it("keeps the visible 404 card unchanged", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "Page not found", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  });
});
