/**
 * UI contract for the backup/restore controls (T87).
 *
 * `fetch` is replaced with a spy: selecting a file and previewing must never
 * write, the preview must show counts before the confirm step, and Cancel must
 * leave the database alone. The server side is covered by the service tests.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportCounts } from "@/features/backup/backup-merge";

import { BackupControls } from "./backup-controls";

function mergeCounts(added: number, replaced: number, skipped: number) {
  return { added, replaced, skipped };
}

function counts(): ImportCounts {
  return {
    favourites: mergeCounts(1, 0, 1),
    watchLater: mergeCounts(0, 0, 0),
    history: mergeCounts(0, 0, 0),
    playlists: mergeCounts(0, 0, 1),
    playlistItems: mergeCounts(0, 0, 0),
    notes: mergeCounts(0, 0, 0),
    progress: mergeCounts(0, 0, 0),
    total: mergeCounts(1, 0, 2),
  };
}

const BACKUP_JSON = JSON.stringify({
  format: "viewly-library-backup",
  version: 1,
  exportedAt: "2026-11-10T12:00:00.000Z",
  data: {
    favourites: [],
    watchLater: [],
    history: [],
    playlists: [],
    notes: [],
    progress: [],
  },
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function previewResponse() {
  return {
    ok: true,
    json: async () => ({
      version: 1,
      exportedAt: "2026-11-10T12:00:00.000Z",
      counts: counts(),
    }),
  };
}

async function chooseBackupFile(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText("Backup file");
  const file = new File([BACKUP_JSON], "backup.json", { type: "application/json" });

  await user.upload(input, file);

  await screen.findByText(/Selected: backup\.json/);
  await waitFor(() => expect(screen.getByRole("button", { name: "Preview backup" })).toBeEnabled());
}

describe("BackupControls", () => {
  it("offers a direct export download", () => {
    render(<BackupControls />);

    const link = screen.getByRole("link", { name: "Download backup" });

    expect(link).toHaveAttribute("href", "/api/library/backup");
    expect(link).toHaveAttribute("download");
    expect(screen.getByLabelText("Backup file")).toHaveClass("min-h-11");
  });

  it("previews counts before the confirm step and does not import on selection", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(previewResponse());

    render(<BackupControls />);

    await chooseBackupFile(user);

    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Preview backup" }));

    expect(await screen.findByRole("heading", { name: "Ready to restore" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been written yet\./)).toBeInTheDocument();
    expect(screen.getByText("Total: 1 added · 0 replaced · 2 skipped")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/library/backup/import?preview=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: BACKUP_JSON,
    });
  });

  it("confirms the restore only after the second press", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(previewResponse()).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        version: 1,
        exportedAt: "2026-11-10T12:00:00.000Z",
        counts: counts(),
      }),
    });

    render(<BackupControls />);

    await chooseBackupFile(user);
    await user.click(screen.getByRole("button", { name: "Preview backup" }));

    const confirm = await screen.findByRole("group", { name: "Confirm restore" });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Restore backup" }));

    expect(await screen.findByRole("heading", { name: "Restore complete" })).toBeInTheDocument();
    expect(
      screen.getByText("1 added, 0 replaced, 2 skipped. Your existing library was kept."),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith("/api/library/backup/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: BACKUP_JSON,
    });
    expect(confirm).not.toBeInTheDocument();
  });

  it("cancels the preview without importing", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(previewResponse());

    render(<BackupControls />);

    await chooseBackupFile(user);
    await user.click(screen.getByRole("button", { name: "Preview backup" }));
    await screen.findByRole("heading", { name: "Ready to restore" });

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("heading", { name: "Ready to restore" })).toBeNull();
    expect(screen.queryByText(/Selected: backup\.json/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Preview backup" })).toBeDisabled();
  });

  it("shows the validation message returned by the server", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: {
          code: "VALIDATION_FAILED",
          message: "data.notes[0].startSeconds: data.notes[0].startSeconds must be at least 0.",
          field: "data.notes[0].startSeconds",
        },
      }),
    });

    render(<BackupControls />);

    await chooseBackupFile(user);
    await user.click(screen.getByRole("button", { name: "Preview backup" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "data.notes[0].startSeconds must be at least 0",
    );
    expect(screen.queryByRole("heading", { name: "Ready to restore" })).toBeNull();
  });
});
