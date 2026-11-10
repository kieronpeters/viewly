import type { Metadata } from "next";
import Link from "next/link";

import { BackupControls } from "@/features/backup/backup-controls";

export const metadata: Metadata = {
  title: "Backup & restore · Viewly",
  description: "Export or merge a versioned JSON backup of your local library.",
};

/**
 * `/library/backup` route (T87).
 *
 * The page has no server data of its own: the export is a link to the route
 * handler and the restore flow reads the chosen file in the browser. That keeps
 * this route a static shell under Cache Components while every SQLite read and
 * write stays inside the existing `/api/library/backup` handlers.
 *
 * It lives under `/library` so the app shell highlights the Library
 * destination and the controls are reachable from the library header.
 */
export default function LibraryBackupPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/library"
          className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          ← Back to library
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Backup &amp; restore
        </h1>
        <p className="text-sm text-muted-foreground">
          Export your library as a JSON file, or merge one back in. Everything stays on this device.
        </p>
      </header>

      <BackupControls />
    </div>
  );
}
