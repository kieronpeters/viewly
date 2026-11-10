import Link from "next/link";
import { io } from "next/cache";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatWatchTime, getWatchStats, type WatchStats } from "@/features/stats";

import { WatchHeatmapGrid } from "./watch-heatmap";

export interface StatsPageContentProps {
  /**
   * Reference time for the heatmap window and the streak. The page lets it
   * default to the request clock; tests pass a frozen date.
   */
  now?: Date;
}

/**
 * Request-time half of `/library/stats` (T85).
 *
 * `io()` runs before the synchronous `better-sqlite3` read so Cache Components
 * never captures the aggregates in the static shell. The page wraps this in
 * `<Suspense>`, so the heading and description stay prerendered while the
 * metrics stream in.
 */
export async function StatsPageContent({ now }: StatsPageContentProps) {
  await io();

  const stats = getWatchStats(now ?? new Date());

  if (stats.totals.videosWatched === 0) {
    return (
      <EmptyState
        title="No watch stats yet"
        message="Play a video and your estimated watch time, top channels and streak will appear here. Everything stays on this device."
        action={
          <Button asChild variant="outline" className="min-h-11">
            <Link href="/">Browse videos</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <WatchStatsOverview stats={stats} />
      <TopChannels channels={stats.topChannels} />
      <section aria-labelledby="stats-heatmap-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2
            id="stats-heatmap-heading"
            className="text-lg font-semibold tracking-tight text-foreground"
          >
            Last 12 weeks
          </h2>
          <p className="text-sm text-muted-foreground">
            Estimated watch time per day, based on each video&apos;s last view.
          </p>
        </div>
        <WatchHeatmapGrid heatmap={stats.heatmap} />
      </section>
    </div>
  );
}

interface WatchStatsOverviewProps {
  stats: WatchStats;
}

/** Four headline totals, with the watch-time estimate called out explicitly. */
function WatchStatsOverview({ stats }: WatchStatsOverviewProps) {
  const { totals, currentStreakDays } = stats;
  const missing = totals.videosMissingDuration;
  const estimateDetail =
    missing === 0
      ? "Estimated as video duration × views."
      : `Estimated as video duration × views; ${missing} ${
          missing === 1 ? "video" : "videos"
        } without a duration excluded.`;

  return (
    <section aria-labelledby="stats-overview-heading" className="flex flex-col gap-3">
      <h2
        id="stats-overview-heading"
        className="text-lg font-semibold tracking-tight text-foreground"
      >
        Overview
      </h2>

      <ul role="list" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total watch time"
          value={formatWatchTime(totals.estimatedWatchSeconds) ?? "0m"}
          badge="Estimate"
          detail={estimateDetail}
        />
        <StatCard
          label="Videos watched"
          value={String(totals.videosWatched)}
          detail={`${totals.totalViews} ${
            totals.totalViews === 1 ? "view" : "views"
          } including repeats`}
        />
        <StatCard
          label="Current streak"
          value={`${currentStreakDays} ${currentStreakDays === 1 ? "day" : "days"}`}
          detail={
            currentStreakDays === 0
              ? "Watch something today to start a streak."
              : "Consecutive UTC days with at least one view."
          }
        />
        <StatCard
          label="Top channel"
          value={stats.topChannels[0]?.channelTitle ?? "—"}
          detail={
            stats.topChannels[0] === undefined
              ? "No channel data yet."
              : `${formatWatchTime(stats.topChannels[0].estimatedWatchSeconds) ?? "0m"} estimated`
          }
        />
      </ul>
    </section>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  detail?: string;
  badge?: string;
}

function StatCard({ label, value, detail, badge }: StatCardProps) {
  return (
    <li className="min-w-0">
      <Card className="h-full gap-1 py-4">
        <CardHeader>
          <CardDescription className="flex flex-wrap items-center gap-2">
            <span>{label}</span>
            {badge === undefined ? null : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {badge}
              </span>
            )}
          </CardDescription>
          <CardTitle className="text-2xl break-words tabular-nums">{value}</CardTitle>
        </CardHeader>
        {detail === undefined ? null : (
          <CardContent>
            <p className="text-xs break-words text-muted-foreground">{detail}</p>
          </CardContent>
        )}
      </Card>
    </li>
  );
}

interface TopChannelsProps {
  channels: WatchStats["topChannels"];
}

/**
 * Top channels by estimated time.
 *
 * The repository already sorts and limits the list; this only numbers the rows.
 * Every figure is estimated from the same formula as the headline total.
 */
function TopChannels({ channels }: TopChannelsProps) {
  return (
    <section aria-labelledby="stats-channels-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id="stats-channels-heading"
          className="text-lg font-semibold tracking-tight text-foreground"
        >
          Top channels
        </h2>
        <p className="text-sm text-muted-foreground">
          Ordered by estimated watch time, then channel name.
        </p>
      </div>

      <ol role="list" className="flex flex-col gap-2">
        {channels.map((channel, index) => (
          <li
            key={channel.channelTitle}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-card px-4 py-3 text-card-foreground"
          >
            <span aria-hidden="true" className="w-5 text-sm tabular-nums text-muted-foreground">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 font-medium break-words">{channel.channelTitle}</span>
            <span className="text-sm tabular-nums text-muted-foreground">
              {channel.videosWatched} {channel.videosWatched === 1 ? "video" : "videos"} ·{" "}
              {channel.totalViews} {channel.totalViews === 1 ? "view" : "views"}
            </span>
            <span className="text-sm font-medium tabular-nums">
              {formatWatchTime(channel.estimatedWatchSeconds) ?? "0m"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
