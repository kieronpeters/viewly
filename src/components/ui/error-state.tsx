import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  /** Headline for the failed region. */
  title?: string;
  /** What went wrong, in plain language. Announced with `role="alert"`. */
  message: string;
  /** Optional retry handler; renders a "Try again" button when provided. */
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

/**
 * Presentational failure state for a section. It is not a route-level error
 * boundary: the caller owns recovery (retry, navigation, reporting).
 * `onRetry` needs a client component, since it passes a function.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      data-slot="error-state"
      className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}
    >
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p role="alert" className="max-w-sm text-sm text-muted-foreground">
        {message}
      </p>
      {onRetry ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="mt-1 min-h-11"
        >
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
