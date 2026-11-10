import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { isChannelId } from "@/shared/validation";

import { ChannelPageContent } from "./channel-page-content";
import { readChannel } from "./read-channel";

/** Number of placeholder cards; eight fills a wide grid without a second row gap. */
const PLACEHOLDER_COUNT = 8;

interface ChannelPageProps {
  /**
   * Next 16 params are a promise. The page itself never awaits it: it forwards
   * the promise into `<Suspense>` so the breadcrumb stays in the static shell.
   */
  params: Promise<{ id: string }>;
}

/**
 * Title and description come from the same cached channel read the page body
 * uses. Failures are mapped to neutral titles here: an exception in
 * `generateMetadata` would replace the whole route with the error boundary,
 * which is exactly what the page's own error state exists to avoid.
 */
export async function generateMetadata({ params }: ChannelPageProps): Promise<Metadata> {
  const { id } = await params;

  if (!isChannelId(id)) {
    return { title: "Channel not found" };
  }

  const read = await readChannel(id);

  if (read.status !== "ok") {
    return { title: read.status === "not_found" ? "Channel not found" : "Channel unavailable" };
  }

  return {
    title: read.channel.title,
    description: read.channel.description === "" ? undefined : read.channel.description,
  };
}

/**
 * `/channel/[id]` route shell.
 *
 * Everything here is static: breadcrumb, page container and the loading
 * skeleton. The runtime `params` read and the YouTube calls live in
 * `<ChannelPageContent>`, inside `<Suspense>`, which is the boundary Cache
 * Components requires for request-time data.
 */
export default function ChannelPage({ params }: ChannelPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <ChannelBreadcrumb />

      <Suspense fallback={<ChannelPageSkeleton />}>
        <ChannelPageContent params={params} />
      </Suspense>
    </div>
  );
}

function ChannelBreadcrumb() {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back to home
          </Link>
        </li>
        <li aria-hidden="true" className="text-muted-foreground">
          /
        </li>
        <li aria-current="page" className="text-muted-foreground">
          Channel
        </li>
      </ol>
    </nav>
  );
}

/**
 * Streams while the channel resolves. The skeleton mirrors the real header and
 * `VideoCard` grid so nothing shifts when the content arrives.
 */
function ChannelPageSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">Loading channel…</span>
      <div
        aria-hidden="true"
        className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start sm:p-6"
      >
        <Skeleton className="size-20 shrink-0 rounded-full sm:size-24" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-56 max-w-full" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-16 w-full max-w-2xl rounded-lg" />
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-40" />
        <div
          aria-hidden="true"
          className="grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
        >
          {Array.from({ length: PLACEHOLDER_COUNT }, (_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
