import Link from "next/link";
import { Suspense } from "react";

import { NavLinks } from "@/components/layout/nav-links";

const wordmarkClasses =
  "rounded-sm text-lg font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/**
 * `NavLinks` reads `usePathname()`, which is runtime-only URL data. It is wrapped in
 * `<Suspense>` so the shell can still prerender while the active link resolves on the
 * client. These placeholders reserve exactly the space the nav occupies so the swap
 * causes no layout shift: three `min-h-11` rows with `gap-1` for the sidebar, and one
 * `min-h-14` strip for the bottom bar.
 */
function NavLinksFallback({ variant }: { variant: "sidebar" | "bottom" }) {
  if (variant === "bottom") {
    return <div aria-hidden="true" className="h-14 w-full bg-muted/40" />;
  }

  return (
    <div aria-hidden="true" className="flex flex-col gap-1">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="min-h-11 rounded-md bg-muted/40" />
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background md:flex-row">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 inline-flex min-h-11 -translate-y-20 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground outline-none focus:translate-y-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Skip to content
      </a>

      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
          <Link href="/" className={wordmarkClasses}>
            Viewly
          </Link>
        </div>
        <nav aria-label="Primary" className="flex-1 overflow-y-auto p-3">
          <Suspense fallback={<NavLinksFallback variant="sidebar" />}>
            <NavLinks />
          </Suspense>
        </nav>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-4 md:hidden">
          <Link href="/" className={wordmarkClasses}>
            Viewly
          </Link>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto outline-none"
        >
          {children}
        </main>

        <nav
          aria-label="Primary"
          className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          <Suspense fallback={<NavLinksFallback variant="bottom" />}>
            <NavLinks variant="bottom" />
          </Suspense>
        </nav>
      </div>
    </div>
  );
}
