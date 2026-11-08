import { describe, expect, it } from "vitest";
import {
  IDLE_SKILL_BOOK_TARGET,
  skillBookTargetReducer,
} from "../src/ui/skillBook";

describe("skill book targeting", () => {
  it("begins targeting and toggles the same book off", () => {
    const active = skillBookTargetReducer(IDLE_SKILL_BOOK_TARGET, {
      type: "begin",
      bookInstanceId: "book-1",
    });
    expect(active).toEqual({ active: true, bookInstanceId: "book-1" });
    expect(
      skillBookTargetReducer(active, { type: "begin", bookInstanceId: "book-1" }),
    ).toEqual(IDLE_SKILL_BOOK_TARGET);
  });

  it("switches books and cancels", () => {
    const first = skillBookTargetReducer(IDLE_SKILL_BOOK_TARGET, {
      type: "begin",
      bookInstanceId: "book-1",
    });
    const second = skillBookTargetReducer(first, {
      type: "begin",
      bookInstanceId: "book-2",
    });
    expect(second).toEqual({ active: true, bookInstanceId: "book-2" });
    expect(skillBookTargetReducer(second, { type: "cancel" })).toEqual(
      IDLE_SKILL_BOOK_TARGET,
    );
  });
});
