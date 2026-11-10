import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WatchResumePrompt } from "./watch-resume-prompt";

describe("WatchResumePrompt", () => {
  it("labels the resume action with the saved timestamp", () => {
    render(
      <WatchResumePrompt
        positionSeconds={83}
        durationSeconds={213}
        onResume={vi.fn()}
        onStartOver={vi.fn()}
      />,
    );

    const prompt = screen.getByRole("group", { name: "Resume playback" });

    expect(prompt).toHaveTextContent("You stopped at 1:23.");
    expect(prompt).toHaveTextContent("38% watched");
    expect(screen.getByRole("button", { name: "Resume from 1:23" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start over" })).toBeInTheDocument();
  });

  it("calls onResume and onStartOver from their buttons", async () => {
    const onResume = vi.fn();
    const onStartOver = vi.fn();
    const user = userEvent.setup();

    render(
      <WatchResumePrompt
        positionSeconds={60}
        durationSeconds={200}
        onResume={onResume}
        onStartOver={onStartOver}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Resume from 1:00" }));
    expect(onResume).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Start over" }));
    expect(onStartOver).toHaveBeenCalledTimes(1);
  });

  it("formats an hour-long position as h:mm:ss", () => {
    render(
      <WatchResumePrompt
        positionSeconds={3_723}
        durationSeconds={7_200}
        onResume={vi.fn()}
        onStartOver={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Resume from 1:02:03" })).toBeInTheDocument();
  });
});
