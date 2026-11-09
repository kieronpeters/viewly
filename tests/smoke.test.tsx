import { useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";

import { cn } from "@/lib/utils";

function LikeButton() {
  const [likes, setLikes] = useState(0);

  return (
    <section className={cn("flex", "gap-4")}>
      <h1>Viewly smoke test</h1>
      <p>Likes: {likes}</p>
      <button type="button" onClick={() => setLikes((value) => value + 1)}>
        Like
      </button>
    </section>
  );
}

test("renders user-visible content", () => {
  render(<LikeButton />);

  expect(screen.getByRole("heading", { name: "Viewly smoke test" })).toBeInTheDocument();
  expect(screen.getByText("Likes: 0")).toBeInTheDocument();
});

test("updates the view when the user clicks", async () => {
  const user = userEvent.setup();

  render(<LikeButton />);

  await user.click(screen.getByRole("button", { name: "Like" }));

  expect(screen.getByText("Likes: 1")).toBeInTheDocument();
});

test("resolves the @/* path alias", () => {
  expect(cn("px-2", "px-4")).toBe("px-4");
});
