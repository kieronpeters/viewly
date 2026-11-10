import "server-only";

/**
 * Server-only orchestration for the library backup (T87).
 *
 * The route handlers and tests call these three functions:
 *
 * - {@link exportLibraryBackup} reads the library and builds the versioned
 *   envelope;
 * - {@link previewLibraryBackup} validates the file and returns the counts an
 *   import *would* produce, without writing;
 * - {@link importLibraryBackup} validates, re-plans against the current data
 *   and applies the plan in one transaction.
 *
 * SQL lives in `src/lib/db/repositories/backup.repository.ts`; merge policy
 * lives in `src/features/backup/backup-merge.ts`. This module only wires them
 * to the connection singleton, keeping the route handlers free of both.
 */
import { getDb } from "@/lib/db/client";
import { createBackupRepository } from "@/lib/db/repositories/backup.repository";

import { buildBackupEnvelope, parseBackupText, type BackupEnvelope } from "./backup";
import { planMerge, type ImportCounts } from "./backup-merge";

/** What a preview shows before anything is written. */
export interface BackupPreview {
  version: number;
  /** The backup's own export time, ISO-8601. */
  exportedAt: string;
  counts: ImportCounts;
}

/** What a completed restore reports. */
export interface BackupImportResult {
  version: number;
  /** The backup's own export time, ISO-8601. */
  exportedAt: string;
  counts: ImportCounts;
}

/** Reads the local library and serializes it into the backup envelope. */
export function exportLibraryBackup(exportedAt: Date = new Date()): BackupEnvelope {
  return buildBackupEnvelope(createBackupRepository(getDb()).read(), exportedAt);
}

/**
 * Validates a backup and counts what importing it would change.
 *
 * Nothing is written. A malformed or incompatible file throws a
 * `DomainValidationError` before the database is read.
 */
export function previewLibraryBackup(text: string): BackupPreview {
  const parsed = parseBackupText(text);
  const plan = planMerge(createBackupRepository(getDb()).read(), parsed.data);

  return {
    version: parsed.version,
    exportedAt: parsed.exportedAt.toISOString(),
    counts: plan.counts,
  };
}

/**
 * Validates a backup, re-plans against the current database and merges it.
 *
 * The plan is applied in a single repository transaction. When there is
 * nothing to add or replace, no write transaction is opened at all. A
 * validation failure happens before the repository is touched, so a rejected
 * file changes nothing.
 */
export function importLibraryBackup(text: string): BackupImportResult {
  const parsed = parseBackupText(text);
  const repository = createBackupRepository(getDb());
  const plan = planMerge(repository.read(), parsed.data);

  if (plan.counts.total.added > 0 || plan.counts.total.replaced > 0) {
    repository.apply(plan);
  }

  return {
    version: parsed.version,
    exportedAt: parsed.exportedAt.toISOString(),
    counts: plan.counts,
  };
}
