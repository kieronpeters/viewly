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

export function NavLinks({ variant = "sidebar" }: { variant?: "sidebar" | "bottom" }) {
  const pathname = usePathname();

  return (
    <ul className={cn("flex", variant === "sidebar" ? "flex-col gap-1" : "w-full")}>
      {NAV_ITEMS.map(({ href, label, Icon }) => {
        const isActive = isActivePath(pathname, href);

        return (
          <li key={href} className={variant === "bottom" ? "flex-1" : undefined}>
            <Link
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex w-full items-center rounded-md text-sm outline-none transition-colors",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                variant === "sidebar"
                  ? "min-h-11 gap-3 px-3"
                  : "min-h-14 flex-col justify-center gap-1 px-1 text-xs",
                isActive
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon aria-hidden="true" className={variant === "sidebar" ? "size-4" : "size-5"} />
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
