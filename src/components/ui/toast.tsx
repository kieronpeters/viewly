import { cn } from "@/lib/utils";

export type ToastVariant = "info" | "success" | "error";

export interface ToastProps {
  message: string;
  variant?: ToastVariant;
  className?: string;
}

const surface: Record<ToastVariant, string> = {
  info: "border-border bg-surface-elevated",
  success: "border-primary/40 bg-primary/10",
  error: "border-destructive/40 bg-destructive/10",
};

const dot: Record<ToastVariant, string> = {
  info: "bg-muted-foreground",
  success: "bg-primary",
  error: "bg-destructive",
};

/**
 * A minimal status message. This is a building block for later pages: it does
 * not include a provider, portal, queue or auto-dismiss timer, and it stays in
 * the flow where the caller renders it. Wire those up in the feature that owns
 * the notification.
 *
 * Errors are assertive (`role="alert"`) because they interrupt; every other
 * variant is a polite `role="status"`.
 */
export function Toast({ message, variant = "info", className }: ToastProps) {
  return (
    <div
      data-slot="toast"
      data-variant={variant}
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm text-foreground",
        surface[variant],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", dot[variant])}
      />
      <span>{message}</span>
    </div>
  );
}
