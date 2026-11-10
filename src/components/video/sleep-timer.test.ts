import { describe, expect, it } from "vitest";

import {
  formatSleepTimerRemaining,
  SLEEP_TIMER_DEFAULT_MINUTES,
  SLEEP_TIMER_OPTIONS_MINUTES,
  sleepTimerDeadline,
  sleepTimerRemainingSeconds,
} from "./sleep-timer";

describe("sleep timer helpers", () => {
  it("offers sensible durations and a default in range", () => {
    expect(SLEEP_TIMER_OPTIONS_MINUTES).toContain(SLEEP_TIMER_DEFAULT_MINUTES);
    expect(SLEEP_TIMER_OPTIONS_MINUTES.every((minutes) => minutes > 0)).toBe(true);
  });

  it("computes a deadline from the current clock", () => {
    expect(sleepTimerDeadline(5, 1_000)).toBe(301_000);
  });

  it("rounds the remaining time up and never returns a negative value", () => {
    expect(sleepTimerRemainingSeconds(61_000, 1_000)).toBe(60);
    expect(sleepTimerRemainingSeconds(1_500, 1_500)).toBe(0);
    expect(sleepTimerRemainingSeconds(500, 1_500)).toBe(0);
    expect(sleepTimerRemainingSeconds(Number.NaN, 1_000)).toBe(0);
  });

  it("formats m:ss and h:mm:ss", () => {
    expect(formatSleepTimerRemaining(300)).toBe("5:00");
    expect(formatSleepTimerRemaining(65)).toBe("1:05");
    expect(formatSleepTimerRemaining(3_661)).toBe("1:01:01");
    expect(formatSleepTimerRemaining(-5)).toBe("0:00");
  });
});
