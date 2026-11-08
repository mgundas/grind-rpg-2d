export type SkillBookTarget =
  | { active: false }
  | { active: true; bookInstanceId: string };

export const IDLE_SKILL_BOOK_TARGET: SkillBookTarget = { active: false };

export type SkillBookTargetAction =
  | { type: "begin"; bookInstanceId: string }
  | { type: "cancel" };

export function skillBookTargetReducer(
  state: SkillBookTarget,
  action: SkillBookTargetAction,
): SkillBookTarget {
  switch (action.type) {
    case "begin":
      if (state.active && state.bookInstanceId === action.bookInstanceId) {
        return IDLE_SKILL_BOOK_TARGET;
      }
      return { active: true, bookInstanceId: action.bookInstanceId };
    case "cancel":
      return IDLE_SKILL_BOOK_TARGET;
    default:
      return state;
  }
}
