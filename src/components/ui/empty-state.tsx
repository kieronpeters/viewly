import * as React from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Short headline, e.g. "No results yet". */
  title: string;
  /** Optional supporting sentence in muted text. */
  message?: string;
  /** Optional decorative icon or illustration shown above the title. */
  icon?: React.ReactNode;
  /** Optional call to action, typically a `Button` or link. */
  action?: React.ReactNode;
  className?: string;
}

/** Centred placeholder for a region with no content. Presentational only. */
export function EmptyState({ title, message, icon, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <h2 className="text-base font-semibold break-words text-foreground">{title}</h2>
      {message ? (
        <p className="max-w-sm text-sm break-words text-muted-foreground">{message}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
