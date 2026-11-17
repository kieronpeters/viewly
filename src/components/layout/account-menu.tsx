import Link from "next/link";

import { getSessionAccount, readGoogleConfig } from "@/lib/auth/google";

/**
 * Masthead account slot: "Sign in" when signed out, swipe-in account entry when
 * signed in. Reads the session cookie on the server; AppShell renders it inside
 * a Suspense boundary so the shell itself stays prerenderable.
 */
export async function AccountMenu() {
  const config = readGoogleConfig();
  const account = await getSessionAccount();

  if (account) {
    return (
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/you"
          className="inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {(account.email || "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">
            {account.email}
          </span>
        </Link>
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-full px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign out
          </button>
        </form>
      </div>
    );
  }

  return (
    <Link
      href={config ? "/api/auth/google/start" : "/you"}
      className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border px-3 py-1.5 text-sm font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      Sign in
    </Link>
  );
}
