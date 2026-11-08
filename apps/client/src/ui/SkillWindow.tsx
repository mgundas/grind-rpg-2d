import { useEffect } from "react";
import { getClass } from "@jadethrone/data/classes";
import { skillsForDoctrine } from "../data/catalog";
import { sendChooseDoctrine, sendUpgradeSkill } from "../network/session";
import { theme } from "./theme";
import { useUiStore } from "./store";
import { Window } from "./Window";

export function SkillWindow() {
  const open = useUiStore((state) => state.skillWindowOpen);
  const self = useUiStore((state) => state.selfStats);
  const state = useUiStore((state) => state.skillState);
  const characters = useUiStore((state) => state.characters);
  const selectedId = useUiStore((state) => state.selectedCharacterId);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      const store = useUiStore.getState();
      if (event.key === "Escape" && store.skillWindowOpen) {
        store.setSkillWindowOpen(false);
        return;
      }
      if (!store.chatFocused && event.key.toLowerCase() === "k") {
        store.toggleSkillWindow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open || !self) {
    return null;
  }
  const character = characters.find((candidate) => candidate.id === selectedId);
  const classInfo = character ? getClass(character.classId) : null;
  const doctrine = state?.doctrine ?? self.doctrine ?? null;
  const doctrineInfo = classInfo?.doctrines.find((entry) => entry.id === doctrine);

  return (
    <Window
      id="skills"
      title="Skills"
      width={430}
      onClose={() => useUiStore.getState().setSkillWindowOpen(false)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
        <span style={{ color: theme.gold }}>
          {doctrineInfo ? doctrineInfo.name : "Choose a doctrine"}
        </span>
        <span style={{ color: theme.muted }}>
          Points: {state?.skillPoints ?? self.skillPoints ?? 0} / {state?.totalSkillPoints ?? "?"}
        </span>
      </div>

      {!classInfo ? (
        <p style={{ fontSize: 11, color: theme.muted }}>Waiting for character data…</p>
      ) : !doctrine ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 10, color: theme.muted }}>
            Choose one doctrine at level 5. The choice is permanent.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {classInfo.doctrines.map((entry) => (
              <button
                key={entry.id}
                type="button"
                disabled={self.level < 5}
                onClick={() => sendChooseDoctrine(entry.id)}
                style={{
                  textAlign: "left",
                  padding: 8,
                  borderRadius: 7,
                  border: `1px solid ${theme.jade}`,
                  background: "rgba(16,24,21,0.9)",
                  color: theme.text,
                  cursor: self.level >= 5 ? "pointer" : "default",
                  opacity: self.level >= 5 ? 1 : 0.55,
                }}
              >
                <div style={{ color: theme.gold, fontWeight: 700, fontSize: 12 }}>{entry.name}</div>
                <div style={{ fontSize: 10, color: theme.muted, marginTop: 4 }}>
                  {entry.description}
                </div>
              </button>
            ))}
          </div>
          {self.level < 5 ? (
            <p style={{ margin: 0, fontSize: 10, color: theme.muted }}>
              Reach level 5 to choose.
            </p>
          ) : null}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 5 }}>
          {skillsForDoctrine(classInfo.id, doctrine).map((skill) => {
            const rank = state?.skills.find((entry) => entry.skillId === skill.id)?.rank ?? 0;
            const locked = self.level < skill.unlockLevel;
            const canLearn =
              !locked && rank < skill.maxRank && (state?.skillPoints ?? 0) > 0;
            return (
              <div
                key={skill.id}
                draggable={rank > 0}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/x-jt-skill", skill.id);
                  useUiStore.getState().setDraggedSkillId(skill.id);
                }}
                onDragEnd={() => useUiStore.getState().setDraggedSkillId(null)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  padding: 7,
                  borderRadius: 6,
                  border: `1px solid ${rank > 0 ? theme.jade : theme.jadeDark}`,
                  opacity: locked ? 0.5 : 1,
                  background: rank > 0 ? "rgba(23,34,30,0.85)" : "rgba(12,17,15,0.7)",
                }}
              >
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 700, fontSize: 12, color: theme.textStrong }}>
                      {skill.name}
                    </span>
                    <span style={{ fontSize: 9, color: theme.gold }}>
                      {rank > 0 ? `Rank ${rank}/${skill.maxRank}` : locked ? `Lv ${skill.unlockLevel}` : "Not learned"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>
                    {skill.description}
                  </div>
                  <div style={{ fontSize: 9, color: "#7d8a84", marginTop: 2 }}>
                    {skill.mpCost.base} MP · {skill.cooldownMs / 1000}s CD · {skill.type}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!canLearn}
                  onClick={() => sendUpgradeSkill(skill.id)}
                  style={{
                    alignSelf: "center",
                    minWidth: 28,
                    height: 26,
                    borderRadius: 5,
                    border: `1px solid ${theme.jade}`,
                    background: canLearn ? theme.jade : "transparent",
                    color: canLearn ? "#0f1210" : theme.muted,
                    fontWeight: 700,
                    cursor: canLearn ? "pointer" : "default",
                  }}
                >
                  +
                </button>
              </div>
            );
          })}
          <p style={{ margin: "4px 0 0", fontSize: 9, color: theme.muted }}>
            Drag a learned skill to the hotbar. Rank costs one point.
          </p>
        </div>
      )}
    </Window>
  );
}
