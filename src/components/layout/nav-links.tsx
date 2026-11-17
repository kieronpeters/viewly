"use client";

import { Home, Library, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/search", label: "Search", Icon: Search },
  { href: "/library", label: "Library", Icon: Library },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export interface NavLinksProps {
  variant?: "rail" | "bottom";
}

/**
 * Primary destinations.
 *
 * `rail` is the 72px icon rail under the masthead (icon above a 10px label),
 * `bottom` is the narrow-screen bar. Both read the same route list, so the two
 * responsive presentations cannot drift apart.
 */
export function NavLinks({ variant = "rail" }: NavLinksProps) {
  const pathname = usePathname();
  const isRail = variant === "rail";

  return (
    <ul className={cn("flex", isRail ? "flex-col gap-0.5 px-1" : "w-full")}>
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const isActive = isActivePath(pathname, href);

        return (
          <li key={href} className={isRail ? undefined : "flex-1"}>
            <Link
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex w-full items-center outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isRail
                  ? "h-[74px] flex-col justify-center gap-1 rounded-xl px-1 text-[10px] leading-none"
                  : "min-h-14 flex-col justify-center gap-1 px-1 text-xs",
                isActive
                  ? "bg-muted font-medium text-foreground"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className={isRail ? "size-6" : "size-5"} />
              <span className="max-w-full truncate">{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
