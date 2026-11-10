// @vitest-environment node
/**
 * Contract tests for the playback-progress Server Actions (T68).
 *
 * The actions run against a real, fully migrated SQLite file supplied through a
 * mocked `getDb`; only `next/cache` is stubbed, because a plain Vitest process
 * has no request context to revalidate. `data/viewly.db` is never opened.
 *
 * The repository's upsert/clamp behaviour is covered by
 * `progress.repository.test.ts`. These tests pin the action contract on top:
 * validation before any write, no row for a video that never played, clearing
 * at 95%, and the two revalidation paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { revalidatePathMock, dbHolder } = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
  /** Replaced with the migrated test client in `beforeEach`. */
  dbHolder: { db: undefined as unknown },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/db/client", () => ({ getDb: () => dbHolder.db }));

import { createProgressRepository } from "@/lib/db/repositories/progress.repository";
import { DomainValidationError } from "@/shared/validation";

import { createTestLibraryDatabase, type TestLibraryDatabase } from "../../../tests/library-db";
import { clearProgress, saveProgress } from "./actions";

const VIDEO_ID = "dQw4w9WgXcQ";
const DURATION = 200;

let library: TestLibraryDatabase;
let repository: ReturnType<typeof createProgressRepository>;

beforeEach(() => {
  library = createTestLibraryDatabase();
  repository = createProgressRepository(library.db);
  dbHolder.db = library.db;
  revalidatePathMock.mockReset();
});

afterEach(() => {
  library.dispose();
});

describe("saveProgress", () => {
  it("stores a valid position and revalidates the library", async () => {
    await expect(saveProgress(VIDEO_ID, 42.9, DURATION)).resolves.toBeUndefined();

    const row = repository.get(VIDEO_ID);

    expect(row).toMatchObject({
      videoId: VIDEO_ID,
      positionSeconds: 42,
      durationSeconds: DURATION,
    });
    expect(row?.updatedAt).toBeInstanceOf(Date);
    expect(revalidatePathMock.mock.calls).toEqual([["/library"]]);
  });

  it("ignores a video that never played", async () => {
    await saveProgress(VIDEO_ID, 0, DURATION);
    await saveProgress(VIDEO_ID, 0.9, DURATION);

    expect(repository.get(VIDEO_ID)).toBeUndefined();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("clears progress at 95% instead of saving it", async () => {
    repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 100,
      durationSeconds: DURATION,
      updatedAt: new Date(1_000),
    });

    await saveProgress(VIDEO_ID, DURATION * 0.95, DURATION);

    expect(repository.get(VIDEO_ID)).toBeUndefined();
    expect(revalidatePathMock).toHaveBeenCalledTimes(1);
  });

  it("still saves just below the completion threshold", async () => {
    await saveProgress(VIDEO_ID, DURATION * 0.94, DURATION);

    expect(repository.get(VIDEO_ID)?.positionSeconds).toBe(188);
  });

  it("treats a position past the end as complete", async () => {
    repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 100,
      durationSeconds: DURATION,
      updatedAt: new Date(1_000),
    });

    await saveProgress(VIDEO_ID, 500, DURATION);

    expect(repository.get(VIDEO_ID)).toBeUndefined();
  });

  it("rejects invalid input before writing or revalidating", async () => {
    await expect(saveProgress("too-short", 10, DURATION)).rejects.toBeInstanceOf(
      DomainValidationError,
    );
    await expect(saveProgress(VIDEO_ID, -5, DURATION)).rejects.toBeInstanceOf(
      DomainValidationError,
    );
    await expect(saveProgress(VIDEO_ID, 10, 0)).rejects.toBeInstanceOf(DomainValidationError);

    expect(repository.get(VIDEO_ID)).toBeUndefined();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("clearProgress", () => {
  it("deletes the row and revalidates", async () => {
    repository.save({
      videoId: VIDEO_ID,
      positionSeconds: 50,
      durationSeconds: DURATION,
      updatedAt: new Date(1_000),
    });

    await expect(clearProgress(VIDEO_ID)).resolves.toBeUndefined();

    expect(repository.get(VIDEO_ID)).toBeUndefined();
    expect(revalidatePathMock.mock.calls).toEqual([["/library"]]);
  });

  it("is idempotent and does not revalidate when there was nothing to clear", async () => {
    await clearProgress(VIDEO_ID);
    await clearProgress(VIDEO_ID);

    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed video id", async () => {
    await expect(clearProgress("nope")).rejects.toBeInstanceOf(DomainValidationError);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});
