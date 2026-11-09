import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Toast } from "@/components/ui/toast";

describe("EmptyState", () => {
  it("renders its title, message and action", () => {
    render(
      <EmptyState
        title="No videos yet"
        message="Search for a video to start your library."
        action={<Button>Search videos</Button>}
      />,
    );

    expect(screen.getByText("No videos yet")).toBeInTheDocument();
    expect(screen.getByText("Search for a video to start your library.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search videos" })).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("announces the message and runs the retry action", async () => {
    const onRetry = vi.fn();

    render(<ErrorState message="Could not load videos." onRetry={onRetry} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load videos.");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("Toast", () => {
  it("announces informational messages politely", () => {
    render(<Toast message="Saved to Watch Later." />);

    expect(screen.getByRole("status")).toHaveTextContent("Saved to Watch Later.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("announces errors assertively", () => {
    render(<Toast message="Could not save." variant="error" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not save.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
