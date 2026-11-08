/** "Apply scroll to item" targeting mode shared by inventory and equipment. */
export type ScrollTargetMode =
  | { active: false }
  | { active: true; scrollInstanceId: string; scrollItemId: string };

export const IDLE_SCROLL_TARGET: ScrollTargetMode = { active: false };

export type ScrollTargetAction =
  | { type: "begin"; scrollInstanceId: string; scrollItemId: string }
  | { type: "cancel" };

export function scrollTargetReducer(
  state: ScrollTargetMode,
  action: ScrollTargetAction,
): ScrollTargetMode {
  switch (action.type) {
    case "begin":
      if (
        state.active &&
        state.scrollInstanceId === action.scrollInstanceId
      ) {
        return IDLE_SCROLL_TARGET;
      }
      return {
        active: true,
        scrollInstanceId: action.scrollInstanceId,
        scrollItemId: action.scrollItemId,
      };
    case "cancel":
      return IDLE_SCROLL_TARGET;
    default:
      return state;
  }
}
