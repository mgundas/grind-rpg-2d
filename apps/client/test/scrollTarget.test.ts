import { describe, expect, it } from "vitest";
import {
  IDLE_SCROLL_TARGET,
  scrollTargetReducer,
  type ScrollTargetMode,
} from "../src/ui/scrollTarget";

describe("scroll target mode", () => {
  it("begins targeting with the selected scroll", () => {
    const state = scrollTargetReducer(IDLE_SCROLL_TARGET, {
      type: "begin",
      scrollInstanceId: "scroll-1",
      scrollItemId: "scroll_enchant",
    });
    expect(state).toEqual({
      active: true,
      scrollInstanceId: "scroll-1",
      scrollItemId: "scroll_enchant",
    });
  });

  it("toggles off when the same scroll is selected again", () => {
    const active = scrollTargetReducer(IDLE_SCROLL_TARGET, {
      type: "begin",
      scrollInstanceId: "scroll-1",
      scrollItemId: "scroll_enchant",
    });
    expect(
      scrollTargetReducer(active, {
        type: "begin",
        scrollInstanceId: "scroll-1",
        scrollItemId: "scroll_enchant",
      }),
    ).toEqual(IDLE_SCROLL_TARGET);
  });

  it("switches to another scroll and cancels explicitly", () => {
    const active: ScrollTargetMode = {
      active: true,
      scrollInstanceId: "scroll-1",
      scrollItemId: "scroll_enchant",
    };
    const switched = scrollTargetReducer(active, {
      type: "begin",
      scrollInstanceId: "scroll-2",
      scrollItemId: "scroll_reinforce",
    });
    expect(switched).toMatchObject({ scrollInstanceId: "scroll-2" });
    expect(scrollTargetReducer(switched, { type: "cancel" })).toEqual(IDLE_SCROLL_TARGET);
  });

  it("cancelling idle state is a no-op", () => {
    expect(scrollTargetReducer(IDLE_SCROLL_TARGET, { type: "cancel" })).toEqual(
      IDLE_SCROLL_TARGET,
    );
  });
});
