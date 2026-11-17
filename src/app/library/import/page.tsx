import Link from "next/link";

import { ImportHistoryForm } from "./import-form";

export const metadata = { title: "Import history · Viewly" };

/**
 * Google Takeout history import.
 *
 * The Data API has no watch-history endpoint, so the owner's own Takeout export
 * is the only legitimate source. The file is parsed locally; nothing is uploaded.
 */
export default function ImportHistoryPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-8">
      <div className="flex flex-col gap-1">
        <Link href="/you" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to your account
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Import your YouTube history</h1>
      </div>

      <p className="text-sm leading-6 text-muted-foreground">
        YouTube does not expose watch history through its API. You can still bring your real history
        into Viewly from your own Google Takeout export: open takeout.google.com, select only
        YouTube and YouTube Music → history, export as JSON, then pick
        <code className="mx-1 rounded bg-muted px-1.5 py-0.5">watch-history.json</code> here. The
        file is read on this machine and never uploaded; re-importing updates timestamps instead of
        duplicating entries.
      </p>

      <ImportHistoryForm />
    </div>
  );
}
