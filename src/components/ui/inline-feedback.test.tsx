import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  INLINE_FEEDBACK_VISIBLE_MS,
  InlineFeedback,
  useTransientFeedback,
} from "@/components/ui/inline-feedback";

/**
 * The shared save-confirmation primitive. These are structure tests only: the
 * exact pixels of the fade are not part of the contract.
 */
describe("InlineFeedback", () => {
  it("keeps an empty polite live region mounted so announcements are observed", () => {
    render(<InlineFeedback message={null} />);

    const region = screen.getByRole("status");

    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "true");
    expect(region).toBeEmptyDOMElement();
    expect(region).toHaveClass("opacity-0");
  });

  it("shows the message without leaving the layout or intercepting clicks", () => {
    render(<InlineFeedback message="Added to favourites." />);

    const region = screen.getByRole("status");

    expect(region).toHaveTextContent("Added to favourites.");
    expect(region).toHaveClass("opacity-100");
    expect(region).toHaveClass("pointer-events-none");
    expect(region).not.toHaveClass("opacity-0");
  });

  it("honours reduced motion on the fade", () => {
    render(<InlineFeedback message="Saved." />);

    expect(screen.getByRole("status")).toHaveClass("motion-reduce:transition-none");
  });
});

describe("useTransientFeedback", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the message after the timeout", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTransientFeedback(1000));

    act(() => result.current.show("Added to favourites."));
    expect(result.current.message).toBe("Added to favourites.");

    act(() => vi.advanceTimersByTime(999));
    expect(result.current.message).toBe("Added to favourites.");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.message).toBeNull();
  });

  it("restarts the timeout when a newer message arrives", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTransientFeedback(1000));

    act(() => result.current.show("Added to favourites."));
    act(() => vi.advanceTimersByTime(800));
    act(() => result.current.show("Removed from favourites."));

    act(() => vi.advanceTimersByTime(800));
    expect(result.current.message).toBe("Removed from favourites.");

    act(() => vi.advanceTimersByTime(200));
    expect(result.current.message).toBeNull();
  });

  it("dismisses immediately and cancels the pending timer", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTransientFeedback(1000));

    act(() => result.current.show("Added to favourites."));
    act(() => result.current.dismiss());

    expect(result.current.message).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("defaults to the shared visible duration", () => {
    vi.useFakeTimers();

    const { result } = renderHook(() => useTransientFeedback());

    act(() => result.current.show("Saved."));

    act(() => vi.advanceTimersByTime(INLINE_FEEDBACK_VISIBLE_MS - 1));
    expect(result.current.message).toBe("Saved.");

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.message).toBeNull();
  });
});
