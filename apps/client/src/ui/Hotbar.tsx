import { useEffect, useMemo, useState } from "react";
import {
  RARITY_COLORS,
  type CastSkillMessage,
  type ItemInstanceDto,
} from "@jadethrone/shared";
import { getItem, hasItem } from "@jadethrone/data/items";
import { getSkill, hasSkill } from "@jadethrone/data/skills";
import { sendCastSkill, sendUseItem } from "../network/session";
import {
  HOTBAR_SLOT_COUNT,
  loadHotbar,
  saveHotbar,
  type HotbarBinding,
  type HotbarBindings,
} from "./hotbarStorage";
import { useUiStore } from "./store";
import { theme } from "./theme";

const KEY_LABELS = ["1", "2", "3", "4", "F1", "F2", "F3", "F4"];

function keyForSlot(index: number): string {
  return KEY_LABELS[index] ?? "";
}

function castRequest(binding: HotbarBinding): CastSkillMessage | null {
  if (binding.kind !== "skill" || !hasSkill(binding.id)) {
    return null;
  }
  const skill = getSkill(binding.id);
  const store = useUiStore.getState();
  if (store.autoWalk) {
    return null;
  }
  const request: CastSkillMessage = { skillId: skill.id };
  const aim = store.cursorWorld;
  if (store.selfPosition && aim) {
    const angle = Math.atan2(aim.y - store.selfPosition.y, aim.x - store.selfPosition.x);
    let dir = Math.round(angle / (Math.PI / 4));
    if (dir < 0) dir += 8;
    request.dir = dir % 8;
  }
  if (skill.target === "ground" && aim) {
    request.x = aim.x;
    request.y = aim.y;
  } else if (skill.target === "enemy") {
    if (store.targetMonsterId) {
      request.targetMonsterId = store.targetMonsterId;
    } else if (store.targetStoneId) {
      request.targetStoneId = store.targetStoneId;
    } else if (store.cursorWorld) {
      request.x = store.cursorWorld.x;
      request.y = store.cursorWorld.y;
    }
  } else if (skill.target === "ally" && store.healTargetCharacterId) {
    request.targetCharacterId = store.healTargetCharacterId;
  }
  return request;
}

/** Two rows of four slots; each holds an item or a learned skill. */
export function Hotbar() {
  const characterId = useUiStore((state) => state.selectedCharacterId);
  const inventory = useUiStore((state) => state.inventory);
  const skillState = useUiStore((state) => state.skillState);
  const [bindingsByCharacter, setBindingsByCharacter] = useState<
    Record<string, HotbarBindings>
  >({});
  const [now, setNow] = useState(0);
  const draggedItemId = useUiStore((state) => state.draggedItemId);
  const draggedSkillId = useUiStore((state) => state.draggedSkillId);
  const setDraggedItemId = useUiStore((state) => state.setDraggedItemId);
  const setDraggedSkillId = useUiStore((state) => state.setDraggedSkillId);
  const bindings = characterId
    ? (bindingsByCharacter[characterId] ?? loadHotbar(characterId))
    : loadHotbar(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(timer);
  }, []);

  function updateBindings(next: HotbarBindings): void {
    if (!characterId) {
      return;
    }
    setBindingsByCharacter((current) => ({ ...current, [characterId]: next }));
    saveHotbar(characterId, next);
  }

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of inventory?.items ?? []) {
      map.set(item.itemId, (map.get(item.itemId) ?? 0) + item.quantity);
    }
    return map;
  }, [inventory]);

  function bindSlot(index: number, dragged: HotbarBinding | null): void {
    if (!dragged) {
      return;
    }
    const next = [...bindings];
    next[index] = dragged;
    updateBindings(next);
    setDraggedItemId(null);
    setDraggedSkillId(null);
  }

  function triggerSlot(index: number): void {
    const binding = bindings[index];
    if (!binding) {
      return;
    }
    if (binding.kind === "item") {
      const item = [...(inventory?.items ?? [])].find((entry) => entry.itemId === binding.id);
      if (item) {
        sendUseItem(item.id);
      }
      return;
    }
    const request = castRequest(binding);
    if (request) {
      sendCastSkill(request);
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      const store = useUiStore.getState();
      if (store.chatFocused || store.dead) {
        return;
      }
      const index = KEY_LABELS.indexOf(event.key.toUpperCase());
      if (index >= 0) {
        event.preventDefault();
        triggerSlot(index);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dragged: HotbarBinding | null = draggedSkillId
    ? { kind: "skill", id: draggedSkillId }
    : draggedItemId && hasItem(draggedItemId)
      ? { kind: "item", id: draggedItemId }
      : null;

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 104,
        transform: "translateX(-50%)",
        display: "grid",
        gridTemplateColumns: "repeat(4, 46px)",
        gap: 4,
        padding: 5,
        borderRadius: 8,
        border: theme.panelBorder,
        background: "rgba(13, 18, 16, 0.92)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.5)",
        pointerEvents: "auto",
        zIndex: 15,
      }}
    >
      {Array.from({ length: HOTBAR_SLOT_COUNT }, (_, index) => {
        const binding = bindings[index] ?? null;
        const itemDefinition =
          binding?.kind === "item" && hasItem(binding.id) ? getItem(binding.id) : null;
        const skill =
          binding?.kind === "skill" && hasSkill(binding.id) ? getSkill(binding.id) : null;
        const count =
          binding?.kind === "item" ? (counts.get(binding.id) ?? 0) : 0;
        const item: ItemInstanceDto | undefined =
          binding?.kind === "item"
            ? (inventory?.items ?? []).find((entry) => entry.itemId === binding.id)
            : undefined;
        const rank =
          skillState?.skills.find((entry) => entry.skillId === skill?.id)?.rank ?? 0;
        const readyAtMs =
          skillState?.skills.find((entry) => entry.skillId === skill?.id)?.readyAtMs ?? 0;
        const remaining = skill ? Math.max(0, readyAtMs - now) : 0;
        const cooldownRatio =
          skill && remaining > 0 ? Math.min(1, remaining / Math.max(1, skill.cooldownMs)) : 0;
        return (
          <button
            key={index}
            type="button"
            onClick={() => triggerSlot(index)}
            onPointerUp={() => bindSlot(index, dragged)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const skillId = event.dataTransfer.getData("text/x-jt-skill");
              if (skillId) {
                bindSlot(index, { kind: "skill", id: skillId });
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const next = [...bindings];
              next[index] = null;
              updateBindings(next);
            }}
            style={{
              position: "relative",
              width: 46,
              height: 46,
              borderRadius: 6,
              border: itemDefinition
                ? `1px solid ${RARITY_COLORS[itemDefinition.rarity]}`
                : skill
                  ? "1px solid rgba(93,168,143,0.75)"
                  : "1px solid rgba(255,255,255,0.12)",
              background: itemDefinition
                ? `linear-gradient(180deg, ${RARITY_COLORS[itemDefinition.rarity]}33, rgba(10,14,12,0.9))`
                : skill
                  ? "linear-gradient(180deg, rgba(93,168,143,0.25), rgba(10,14,12,0.9))"
                  : "rgba(8,11,10,0.75)",
              color: theme.text,
              cursor: "pointer",
              fontFamily: "system-ui, sans-serif",
              padding: 2,
              opacity: (binding?.kind === "item" ? item : skill) || !binding ? 1 : 0.45,
              overflow: "hidden",
            }}
            title={
              itemDefinition
                ? `${itemDefinition.name} (${count})`
                : skill
                  ? `${skill.name} · rank ${rank} · ${skill.mpCost.base} MP`
                  : `Hotbar ${keyForSlot(index)}`
            }
          >
            <span
              style={{
                position: "absolute",
                left: 3,
                top: 1,
                fontSize: 9,
                color: theme.gold,
                fontWeight: 700,
                zIndex: 2,
              }}
            >
              {keyForSlot(index)}
            </span>
            <span style={{ fontSize: 10, fontWeight: 700, zIndex: 2 }}>
              {itemDefinition
                ? itemDefinition.name.slice(0, 5)
                : skill
                  ? skill.name.slice(0, 6)
                  : ""}
            </span>
            {count > 1 || item ? (
              <span
                style={{
                  position: "absolute",
                  right: 3,
                  bottom: 1,
                  fontSize: 10,
                  color: "#fff",
                  textShadow: "0 1px 2px #000",
                  zIndex: 2,
                }}
              >
                {count}
              </span>
            ) : null}
            {cooldownRatio > 0 ? (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${cooldownRatio * 100}%`,
                  background: "rgba(5,8,7,0.72)",
                  pointerEvents: "none",
                }}
              />
            ) : null}
            {skill && remaining > 0 ? (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#fff",
                  textShadow: "0 1px 2px #000",
                  zIndex: 3,
                }}
              >
                {Math.ceil(remaining / 1000)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
