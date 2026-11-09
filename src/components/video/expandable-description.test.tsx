import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ExpandableDescription } from "./expandable-description";

/** The paragraph that holds the description, found by its stable data slot. */
function descriptionParagraph(container: HTMLElement): HTMLElement {
  const paragraph = container.querySelector('[data-slot="video-description"]');

  if (!(paragraph instanceof HTMLElement)) {
    throw new Error("The description paragraph should be rendered.");
  }

  return paragraph;
}

describe("ExpandableDescription linkification", () => {
  it("renders http and https URLs as safe links that open in a new tab", () => {
    const { container } = render(
      <ExpandableDescription text={"Read https://example.com/docs and http://example.com/faq."} />,
    );

    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(2);

    for (const link of links) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
      expect(link.getAttribute("href")).toMatch(/^https?:\/\//);
    }

    expect(links[0]).toHaveAttribute("href", "https://example.com/docs");
    expect(links[0]).toHaveTextContent(/^https:\/\/example\.com\/docs$/);
    expect(links[1]).toHaveAttribute("href", "http://example.com/faq");
    expect(descriptionParagraph(container).textContent).toBe(
      "Read https://example.com/docs and http://example.com/faq.",
    );
  });

  it("keeps unsafe schemes and malformed URLs as plain text", () => {
    const text =
      "javascript:alert(1) data:text/html,<b>x</b> ftp://example.com/file https:// http:/example.com";
    const { container } = render(<ExpandableDescription text={text} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(descriptionParagraph(container).textContent).toBe(text);
    expect(container.querySelector("b")).toBeNull();
  });

  it("renders a javascript: URL next to a valid link as text", () => {
    render(<ExpandableDescription text={"javascript:alert(1) https://example.com"} />);

    const links = screen.getAllByRole("link");

    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.com/");
    expect(screen.getByText(/javascript:alert\(1\)/)).toBeInTheDocument();
  });

  it("leaves trailing punctuation outside the anchor", () => {
    const { container } = render(
      <ExpandableDescription text={"Docs: https://example.com/docs."} />,
    );

    const link = screen.getByRole("link");

    expect(link).toHaveTextContent(/^https:\/\/example\.com\/docs$/);
    expect(link.nextSibling?.textContent).toBe(".");
    expect(descriptionParagraph(container).textContent).toBe("Docs: https://example.com/docs.");
  });

  it("drops the outer parenthesis of a parenthesized URL", () => {
    render(<ExpandableDescription text={"(see https://example.com/a)"} />);

    const link = screen.getByRole("link");

    expect(link).toHaveTextContent(/^https:\/\/example\.com\/a$/);
    expect(link.nextSibling?.textContent).toBe(")");
  });
});
