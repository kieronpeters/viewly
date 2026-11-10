// @vitest-environment node
/**
 * Contract tests for `GET /api/library/backup`.
 *
 * The service is mocked so these tests pin the HTTP shape — attachment
 * filename, no-store caching and the JSON body — without opening SQLite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { exportLibraryBackupMock, connectionMock } = vi.hoisted(() => ({
  exportLibraryBackupMock: vi.fn(),
  connectionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();

  return { ...actual, connection: connectionMock };
});
vi.mock("@/features/backup/backup-service", () => ({
  exportLibraryBackup: exportLibraryBackupMock,
}));

import { GET } from "@/app/api/library/backup/route";
import type { ApiErrorBody } from "@/lib/errors";

const ENVELOPE = {
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
};

beforeEach(() => {
  connectionMock.mockReset();
  connectionMock.mockResolvedValue(undefined);
  exportLibraryBackupMock.mockReset();
  exportLibraryBackupMock.mockReturnValue(ENVELOPE);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/library/backup", () => {
  it("returns a downloadable JSON attachment from the service", async () => {
    const response = await GET();

    expect(connectionMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="viewly-library-2026-11-10.json"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(ENVELOPE);
  });

  it("maps an unexpected failure to the shared 500 envelope", async () => {
    exportLibraryBackupMock.mockImplementation(() => {
      throw new Error("database exploded");
    });

    const response = await GET();
    const body = (await response.json()) as ApiErrorBody;

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });
});
