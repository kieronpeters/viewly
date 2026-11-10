import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CopyLinkButton } from "./copy-link-button";

const VIDEO_ID = "dQw4w9WgXcQ";

const writeTextMock = vi.fn();

beforeEach(() => {
  writeTextMock.mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: writeTextMock },
    configurable: true,
  });
});

describe("CopyLinkButton", () => {
  it("copies this deployment's watch URL and confirms it", async () => {
    writeTextMock.mockResolvedValue(undefined);

    render(<CopyLinkButton videoId={VIDEO_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/watch/${VIDEO_ID}`);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Link copied to clipboard.");
  });

  it("reports a denied clipboard instead of throwing", async () => {
    writeTextMock.mockRejectedValue(new Error("denied"));

    render(<CopyLinkButton videoId={VIDEO_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Could not copy the link."),
    );
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });
});
