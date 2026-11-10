/**
 * Route-level smoke test for `/library/backup` (T87).
 *
 * The controls themselves are covered by `BackupControls` tests; this only
 * pins the page's heading, its link back to the library and the export entry
 * point, which is what makes the feature reachable from `/library`.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import LibraryBackupPage from "./page";

describe("LibraryBackupPage", () => {
  it("renders the backup heading and a way back to the library", () => {
    render(<LibraryBackupPage />);

    expect(screen.getByRole("heading", { name: "Backup & restore", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Back to library" })).toHaveAttribute(
      "href",
      "/library",
    );
    expect(screen.getByRole("link", { name: "Download backup" })).toHaveAttribute(
      "href",
      "/api/library/backup",
    );
  });
});
