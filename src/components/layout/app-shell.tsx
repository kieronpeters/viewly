import Link from "next/link";

import { NavLinks } from "@/components/layout/nav-links";

const wordmarkClasses =
  "rounded-sm text-lg font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

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
          <NavLinks />
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
          <NavLinks variant="bottom" />
        </nav>
      </div>
    </div>
  );
}
