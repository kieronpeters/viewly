import Link from "next/link";
import { Suspense } from "react";

import { ViewlyLogo } from "@/components/brand/viewly-logo";
import { CommandPalette } from "@/components/layout/command-palette";
import { NavLinks } from "@/components/layout/nav-links";
import { PlayerProvider } from "@/components/player/player-provider";
import { SearchFormWithQuery } from "@/components/search/search-form";
import { PlayerSeekProvider } from "@/components/video/player-seek";

const brandLinkClasses =
  "inline-flex min-h-11 shrink-0 items-center rounded-sm px-2 outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Masthead skeleton. `SearchFormWithQuery` reads request-time URL data, so the
 * search slot streams; the shell itself stays prerenderable.
 */
function SearchFallback() {
  return <div aria-hidden="true" className="h-10 w-full rounded-full bg-surface" />;
}

function RailFallback() {
  return (
    <div aria-hidden="true" className="flex w-full flex-col items-center gap-2 px-2 py-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-14 w-14 rounded-xl bg-muted/40" />
      ))}
    </div>
  );
}

function BottomNavFallback() {
  return <div aria-hidden="true" className="h-14 w-full bg-muted/40" />;
}

/**
 * The application shell, shaped like the observed watch surface: a 56px
 * masthead with the search field centred, a 72px icon rail on wide screens,
 * and a bottom bar on narrow ones. The player, seek channel and command
 * palette stay single-instance across navigation.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <PlayerSeekProvider>
      <PlayerProvider>
        <div className="flex h-dvh flex-col overflow-hidden bg-background">
          <a
            href="#main-content"
            className="fixed left-4 top-4 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Skip to content
          </a>

          <header
            data-slot="masthead"
            className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-2 sm:gap-4 sm:px-4"
          >
            <Link href="/" aria-label="Viewly home" className={brandLinkClasses}>
              <ViewlyLogo size="sm" />
            </Link>

            <div className="mx-auto flex w-full max-w-2xl min-w-0 justify-center px-1">
              <Suspense fallback={<SearchFallback />}>
                <SearchFormWithQuery />
              </Suspense>
            </div>

            <Link
              href="/library"
              className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              You
            </Link>
          </header>

          <div className="flex min-h-0 flex-1">
            <aside
              data-slot="guide-rail"
              className="hidden w-[72px] shrink-0 flex-col border-r border-border bg-background md:flex"
            >
              <nav aria-label="Primary" className="flex-1 py-1">
                <Suspense fallback={<RailFallback />}>
                  <NavLinks variant="rail" />
                </Suspense>
              </nav>
            </aside>

            <main
              id="main-content"
              data-scroll-root
              tabIndex={-1}
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto outline-none"
            >
              {children}
            </main>
          </div>

          <nav
            aria-label="Primary"
            className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
          >
            <Suspense fallback={<BottomNavFallback />}>
              <NavLinks variant="bottom" />
            </Suspense>
          </nav>

          <CommandPalette />
        </div>
      </PlayerProvider>
    </PlayerSeekProvider>
  );
}
