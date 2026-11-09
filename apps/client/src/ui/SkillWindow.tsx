import { useEffect, useState } from "react";
import { getClass } from "@jadethrone/data/classes";
import { skillsForDoctrine } from "../data/catalog";
import { audio } from "../audio/service";
import {
  sendChooseDoctrine,
  sendReadSkillBook,
  sendUpgradeSkill,
} from "../network/session";
import { theme } from "./theme";
import { useUiStore } from "./store";
import { Window } from "./Window";

export function SkillWindow() {
  const open = useUiStore((state) => state.skillWindowOpen);
  const self = useUiStore((state) => state.selfStats);
  const state = useUiStore((state) => state.skillState);
  const characters = useUiStore((state) => state.characters);
  const selectedId = useUiStore((state) => state.selectedCharacterId);
  const skillBookTarget = useUiStore((state) => state.skillBookTarget);
  const cancelSkillBook = useUiStore((state) => state.cancelSkillBook);
  const skillBookResult = useUiStore((state) => state.skillBookResult);
  const setSkillBookResult = useUiStore((state) => state.setSkillBookResult);
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      const store = useUiStore.getState();
      if (event.key === "Escape" && store.skillBookTarget.active) {
        store.cancelSkillBook();
        return;
      }
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

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!skillBookResult) {
      return;
    }
    audio.playSfx(
      skillBookResult.ok && skillBookResult.success ? "sfx.upgrade_success" : "sfx.upgrade_fail",
    );
    const timer = setTimeout(() => setSkillBookResult(null), 5000);
    return () => clearTimeout(timer);
  }, [skillBookResult, setSkillBookResult]);

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

      {skillBookTarget.active ? (
        <div
          style={{
            marginBottom: 8,
            padding: "6px 8px",
            borderRadius: 5,
            border: "1px solid rgba(201,162,39,0.55)",
            background: "rgba(201,162,39,0.1)",
            fontSize: 10,
            color: theme.gold,
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span>Select a rank-20 skill to read the mastery tome.</span>
          <button type="button" style={{ padding: "1px 6px", fontSize: 9 }} onClick={cancelSkillBook}>
            Cancel (Esc)
          </button>
        </div>
      ) : null}
      {skillBookResult ? (
        <div
          style={{
            marginBottom: 8,
            padding: "6px 8px",
            borderRadius: 5,
            border: `1px solid ${skillBookResult.ok && skillBookResult.success ? theme.jade : theme.danger}`,
            background: "rgba(255,255,255,0.03)",
            fontSize: 10,
            color: skillBookResult.ok ? theme.text : theme.danger,
          }}
        >
          {skillBookResult.ok
            ? skillBookResult.success
              ? `Mastery advanced to M${skillBookResult.masterLevel ?? 0}.`
              : `The reading failed; mastery stays at M${skillBookResult.masterLevel ?? 0}.`
            : (skillBookResult.message ?? skillBookResult.code?.replaceAll("_", " "))}
        </div>
      ) : null}

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
            const rankView = state?.skills.find((entry) => entry.skillId === skill.id);
            const rank = rankView?.rank ?? 0;
            const masterLevel = rankView?.masterLevel ?? 0;
            const nextReadAtMs = rankView?.nextReadAtMs ?? 0;
            const locked = self.level < skill.unlockLevel;
            const canLearn =
              !locked && rank < skill.maxRank && (state?.skillPoints ?? 0) > 0;
            const canRead =
              skillBookTarget.active &&
              rank >= 20 &&
              masterLevel < 10 &&
              nowMs >= nextReadAtMs;
            return (
              <div
                key={skill.id}
                draggable={rank > 0 && !skillBookTarget.active}
                onClick={() => {
                  if (skillBookTarget.active && canRead) {
                    sendReadSkillBook(skillBookTarget.bookInstanceId, skill.id);
                  }
                }}
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
                      {masterLevel > 0 ? ` · M${masterLevel}` : ""}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: theme.muted, marginTop: 2 }}>
                    {skill.description}
                  </div>
                  <div style={{ fontSize: 9, color: "#7d8a84", marginTop: 2 }}>
                    {skill.mpCost.base} MP · {skill.cooldownMs / 1000}s CD · {skill.type}
                    {rank >= 20 && masterLevel < 10 && nextReadAtMs > nowMs
                      ? ` · reading ready in ${Math.ceil((nextReadAtMs - nowMs) / 60_000)}m`
                      : ""}
                  </div>
                </div>
                {skillBookTarget.active ? (
                  <button
                    type="button"
                    disabled={!canRead}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (canRead) {
                        sendReadSkillBook(skillBookTarget.bookInstanceId, skill.id);
                      }
                    }}
                    style={{
                      alignSelf: "center",
                      minWidth: 42,
                      height: 26,
                      borderRadius: 5,
                      border: `1px solid ${theme.gold}`,
                      background: canRead ? "rgba(201,162,39,0.25)" : "transparent",
                      color: canRead ? theme.gold : theme.muted,
                      fontWeight: 700,
                      cursor: canRead ? "pointer" : "default",
                      fontSize: 9,
                    }}
                  >
                    Read
                  </button>
                ) : (
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
                )}
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
