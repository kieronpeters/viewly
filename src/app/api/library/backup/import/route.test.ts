// @vitest-environment node
/**
 * Contract tests for `POST /api/library/backup/import`.
 *
 * The service is mocked: these tests pin the preview/confirm query parameter,
 * the raw-text body pass-through and the 400 envelope used for a rejected file.
 * The "rejected file changes nothing" guarantee is covered end to end in
 * `backup-service.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { previewLibraryBackupMock, importLibraryBackupMock } = vi.hoisted(() => ({
  previewLibraryBackupMock: vi.fn(),
  importLibraryBackupMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/backup/backup-service", () => ({
  previewLibraryBackup: previewLibraryBackupMock,
  importLibraryBackup: importLibraryBackupMock,
}));

import { POST } from "@/app/api/library/backup/import/route";
import type { ApiErrorBody } from "@/lib/errors";
import { DomainValidationError } from "@/shared/validation";

const TEXT = '{"format":"viewly-library-backup","version":1}';

const RESULT = {
  version: 1,
  exportedAt: "2026-11-10T12:00:00.000Z",
  counts: {
    favourites: { added: 1, skipped: 0, replaced: 0 },
    watchLater: { added: 0, skipped: 0, replaced: 0 },
    history: { added: 0, skipped: 0, replaced: 0 },
    playlists: { added: 0, skipped: 0, replaced: 0 },
    playlistItems: { added: 0, skipped: 0, replaced: 0 },
    notes: { added: 0, skipped: 0, replaced: 0 },
    progress: { added: 0, skipped: 0, replaced: 0 },
    total: { added: 1, skipped: 0, replaced: 0 },
  },
};

function post(body: string, query = ""): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/library/backup/import${query}`, {
      method: "POST",
      body,
    }),
  );
}

beforeEach(() => {
  previewLibraryBackupMock.mockReset();
  previewLibraryBackupMock.mockReturnValue(RESULT);
  importLibraryBackupMock.mockReset();
  importLibraryBackupMock.mockReturnValue(RESULT);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/library/backup/import", () => {
  it("previews the file without calling the import service", async () => {
    const response = await post(TEXT, "?preview=1");

    expect(previewLibraryBackupMock).toHaveBeenCalledWith(TEXT);
    expect(importLibraryBackupMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(RESULT);
  });

  it("imports the raw text when preview is not requested", async () => {
    const response = await post(TEXT);

    expect(importLibraryBackupMock).toHaveBeenCalledWith(TEXT);
    expect(previewLibraryBackupMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(RESULT);
  });

  it("returns a 400 validation envelope for an incompatible file", async () => {
    previewLibraryBackupMock.mockImplementation(() => {
      throw new DomainValidationError(
        "invalid_format",
        "Unsupported backup version. This app can import version 1.",
        { field: "version" },
      );
    });

    const response = await post(TEXT, "?preview=1");
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      field: "version",
      message: "Unsupported backup version. This app can import version 1.",
    });
  });

  it("keeps malformed_payload as a 400 file error instead of an upstream 502", async () => {
    importLibraryBackupMock.mockImplementation(() => {
      throw new DomainValidationError("malformed_payload", "data.notes is required.", {
        field: "data.notes",
      });
    });

    const response = await post(TEXT);
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.field).toBe("data.notes");
  });

  it("maps an unexpected failure to the shared 500 envelope", async () => {
    importLibraryBackupMock.mockImplementation(() => {
      throw new Error("transaction failed");
    });

    const response = await post(TEXT);
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
