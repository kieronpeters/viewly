import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.ComponentPropsWithoutRef<"input"> {
  /** Marks the field invalid and styles it; `aria-invalid` passed directly wins. */
  invalid?: boolean;
}

/**
 * A native input with token-based borders and a visible focus ring.
 * Pair it with a `<label htmlFor>`; no label or id is generated here.
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", invalid, "aria-invalid": ariaInvalid, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      className={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-surface px-3 py-1 text-sm text-foreground transition-colors outline-none",
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Invalid state is carried by the red border and the linked error
        // message. A red `ring-*` here would compete with the focus ring and
        // win in the cascade, leaving focus indicated at only ~1.5:1.
        "aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
});
