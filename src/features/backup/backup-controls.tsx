"use client";

import { useId, useRef, useState, useTransition, type ChangeEvent } from "react";

import { Button } from "@/components/ui/button";
import { MAX_BACKUP_TEXT_LENGTH } from "@/features/backup/backup";
import type { ImportCounts, MergeCounts } from "@/features/backup/backup-merge";
import { cn } from "@/lib/utils";
import { isRecord } from "@/shared/validation";

/** Successful preview or import response. */
interface BackupResponse {
  version: number;
  exportedAt: string;
  counts: ImportCounts;
}

/** Human labels for the counters, in the order the data is grouped in the file. */
const COUNT_SECTIONS: ReadonlyArray<{
  key: Exclude<keyof ImportCounts, "total">;
  label: string;
}> = [
  { key: "favourites", label: "Favourites" },
  { key: "watchLater", label: "Watch later" },
  { key: "history", label: "History" },
  { key: "playlists", label: "Playlists" },
  { key: "playlistItems", label: "Playlist items" },
  { key: "notes", label: "Notes & highlights" },
  { key: "progress", label: "Playback progress" },
];

/**
 * Export and restore controls for `/library/backup` (T87).
 *
 * The export is a plain link to `GET /api/library/backup`, so the download
 * works before hydration and needs no JavaScript at all. Restore is a
 * three-step flow: choose a file, preview the counts, then confirm. Nothing is
 * sent until **Preview backup** is pressed, and nothing is written until the
 * second, clearly labelled **Restore backup** press; **Cancel** drops the
 * preview and leaves the database untouched.
 *
 * The file is read in the browser and posted as raw JSON text. No File System
 * Access API, Node API or network service is involved, so the flow works
 * entirely offline.
 */
export function BackupControls() {
  const fileInputId = useId();
  const hintId = useId();
  const errorId = useId();
  const previewHeadingId = useId();
  const resultHeadingId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [preview, setPreview] = useState<BackupResponse | null>(null);
  const [result, setResult] = useState<BackupResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    setPreview(null);
    setResult(null);
    setError(null);
    setRawText(null);
    setFileName(null);

    if (file === null) {
      return;
    }

    try {
      const text = await readFileText(file);

      if (text.length > MAX_BACKUP_TEXT_LENGTH) {
        setError(`The backup file must be at most ${MAX_BACKUP_TEXT_LENGTH} characters.`);
        return;
      }

      setFileName(file.name);
      setRawText(text);
    } catch {
      setError("Could not read the selected file. Choose a JSON backup file and try again.");
    }
  }

  function handlePreview() {
    if (rawText === null) {
      return;
    }

    setError(null);
    setResult(null);

    startTransition(async () => {
      try {
        setPreview(await requestBackup(rawText, true));
      } catch (caught) {
        setError(messageFromError(caught));
      }
    });
  }

  function handleRestore() {
    if (rawText === null) {
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        const next = await requestBackup(rawText, false);

        setResult(next);
        setPreview(null);
        resetSelection();
      } catch (caught) {
        setError(messageFromError(caught));
      }
    });
  }

  function handleCancel() {
    setPreview(null);
    setResult(null);
    setError(null);
    resetSelection();
  }

  function resetSelection() {
    setRawText(null);
    setFileName(null);

    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
  }

  const describedBy = error === null ? hintId : `${hintId} ${errorId}`;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="backup-export-heading"
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="backup-export-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Export
          </h2>
          <p className="text-sm text-muted-foreground">
            Download a JSON file with your favourites, watch later, history, playlists, notes and
            highlights, and playback progress. The file is created on this device and is not sent
            anywhere.
          </p>
        </div>

        <div>
          <Button asChild className="min-h-11">
            <a href="/api/library/backup" download>
              Download backup
            </a>
          </Button>
        </div>
      </section>

      <section
        aria-labelledby="backup-restore-heading"
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
      >
        <div className="flex flex-col gap-1">
          <h2
            id="backup-restore-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Restore
          </h2>
          <p className="text-sm text-muted-foreground">
            Choose a backup file, preview what will change, then confirm. Importing never deletes
            local data: an item is only added or replaced when the backup&apos;s copy is newer.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileInputId} className="text-sm font-medium text-foreground">
            Backup file
          </label>
          <input
            ref={fileInputRef}
            id={fileInputId}
            type="file"
            accept=".json,application/json"
            disabled={isPending}
            aria-describedby={describedBy}
            aria-invalid={error === null ? undefined : true}
            onChange={handleFileChange}
            className={cn(
              "min-h-11 w-full cursor-pointer rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground outline-none",
              "file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground",
              "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "aria-invalid:border-destructive",
            )}
          />
          <p id={hintId} className="text-xs text-muted-foreground">
            JSON exported from this app. Maximum {MAX_BACKUP_TEXT_LENGTH} characters.
          </p>
          {fileName === null ? null : (
            <p role="status" className="text-xs text-muted-foreground">
              Selected: {fileName}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-11"
            disabled={isPending || rawText === null}
            onClick={handlePreview}
          >
            Preview backup
          </Button>
        </div>

        {error === null ? null : (
          <p id={errorId} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {preview === null ? null : (
          <section
            aria-labelledby={previewHeadingId}
            className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <div className="flex flex-col gap-1">
              <h3
                id={previewHeadingId}
                className="text-base font-semibold tracking-tight text-foreground"
              >
                Ready to restore
              </h3>
              <p className="text-sm text-muted-foreground">
                Backup exported {formatDate(preview.exportedAt)}. Nothing has been written yet.
              </p>
            </div>

            <CountsList counts={preview.counts} />

            <div role="group" aria-label="Confirm restore" className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-11"
                disabled={isPending}
                onClick={handleRestore}
              >
                Restore backup
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={isPending}
                onClick={handleCancel}
              >
                Cancel
              </Button>
            </div>
          </section>
        )}

        {result === null ? null : (
          <section
            aria-labelledby={resultHeadingId}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <h3
              id={resultHeadingId}
              className="text-base font-semibold tracking-tight text-foreground"
            >
              Restore complete
            </h3>
            <p role="status" className="text-sm text-foreground">
              {result.counts.total.added} added, {result.counts.total.replaced} replaced,{" "}
              {result.counts.total.skipped} skipped. Your existing library was kept.
            </p>
            <CountsList counts={result.counts} />
          </section>
        )}
      </section>
    </div>
  );
}

/** One row per table plus the total, so a preview is scannable without opening a file. */
function CountsList({ counts }: { counts: ImportCounts }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">Total: {describeCounts(counts.total)}</p>
      <dl className="grid gap-2 sm:grid-cols-2">
        {COUNT_SECTIONS.map(({ key, label }) => (
          <div
            key={key}
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-card px-3 py-2 text-sm"
          >
            <dt className="font-medium text-foreground">{label}</dt>
            <dd className="text-muted-foreground">{describeCounts(counts[key])}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function describeCounts(counts: MergeCounts): string {
  return `${counts.added} added · ${counts.replaced} replaced · ${counts.skipped} skipped`;
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/** `2026-11-10T…Z` -> `10 Nov 2026`, deterministic and locale-free. */
function formatDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);

  if (match === null) {
    return iso;
  }

  const month = MONTH_NAMES[Number(match[2]) - 1] ?? match[2];

  return `${Number(match[3])} ${month} ${match[1]}`;
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsText(file);
  });
}

async function requestBackup(text: string, preview: boolean): Promise<BackupResponse> {
  const response = await fetch(`/api/library/backup/import${preview ? "?preview=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: text,
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload) ?? "Could not read the backup file.");
  }

  return readBackupResponse(payload);
}

function readBackupResponse(value: unknown): BackupResponse {
  if (
    !isRecord(value) ||
    typeof value.version !== "number" ||
    typeof value.exportedAt !== "string" ||
    !isRecord(value.counts)
  ) {
    throw new Error("The server returned an unexpected response. Nothing was imported.");
  }

  return {
    version: value.version,
    exportedAt: value.exportedAt,
    counts: value.counts as unknown as ImportCounts,
  };
}

function readErrorMessage(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error)) {
    return null;
  }

  return typeof value.error.message === "string" ? value.error.message : null;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Could not restore the backup. Please try again.";
}
