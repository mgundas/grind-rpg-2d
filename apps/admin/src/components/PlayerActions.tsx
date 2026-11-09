import { useEffect, useRef, useState } from "react";
import type { AdminCharacterDetail, ItemInstanceDto } from "@jadethrone/shared";
import { BONUS_TYPES } from "@jadethrone/shared";
import { getItem, hasItem, ITEMS } from "@jadethrone/data/items";
import { adminApi } from "../network/api";

function itemLabel(itemId: string): string {
  return hasItem(itemId) ? getItem(itemId).name : itemId;
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function PlayerActions({
  detail,
  onChanged,
}: {
  detail: AdminCharacterDetail;
  onChanged: () => void;
}) {
  const character = detail.character;
  const account = detail.account;
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [level, setLevel] = useState(String(character.level));
  const [gold, setGold] = useState(String(character.gold));
  const [vit, setVit] = useState(String(character.stats.vit));
  const [int, setInt] = useState(String(character.stats.int));
  const [str, setStr] = useState(String(character.stats.str));
  const [dex, setDex] = useState(String(character.stats.dex));
  const [x, setX] = useState(String(character.x));
  const [y, setY] = useState(String(character.y));
  const loadedCharacterId = useRef(character.id);

  // Reset the form only when the selected character changes; a refresh after an
  // action must not wipe edits in other fields.
  useEffect(() => {
    if (loadedCharacterId.current === character.id) {
      return;
    }
    loadedCharacterId.current = character.id;
    setLevel(String(character.level));
    setGold(String(character.gold));
    setVit(String(character.stats.vit));
    setInt(String(character.stats.int));
    setStr(String(character.stats.str));
    setDex(String(character.stats.dex));
    setX(String(character.x));
    setY(String(character.y));
  }, [character]);

  const [itemId, setItemId] = useState("sword_ember_t1");
  const [quantity, setQuantity] = useState("1");
  const [upgrade, setUpgrade] = useState("5");
  const [bonusType, setBonusType] = useState<string>(BONUS_TYPES[0]);
  const [bonusValue, setBonusValue] = useState("0");

  const [banMinutes, setBanMinutes] = useState("60");
  const [banReason, setBanReason] = useState("");

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await action();
      setFeedback(`${label} succeeded.`);
      onChanged();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const banned = account.banned;

  const removeButton = (item: ItemInstanceDto, location: string) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        if (!window.confirm(`Remove ${itemLabel(item.itemId)} (${location})?`)) {
          return;
        }
        void run("Remove item", () => adminApi.removeItem(character.id, item.id));
      }}
      className="rounded border border-[#7a3b36] px-2 py-0.5 text-[10px] text-[#ff8f84] hover:bg-[#2a1a18] disabled:opacity-50"
    >
      remove
    </button>
  );

  return (
    <div className="mt-4 grid gap-4 border-t border-[#1d2622] pt-4 text-xs">
      {feedback ? <p className="text-[#7ee08a]">{feedback}</p> : null}
      {error ? <p className="text-[#ff8f84]">{error}</p> : null}

      <section className="grid gap-2 rounded border border-[#1d2622] p-3">
        <h4 className="font-semibold text-[var(--gold)]">Character edit</h4>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <label>
            Level
            <input
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
          </label>
          <label>
            Gold
            <input
              value={gold}
              onChange={(event) => setGold(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
          </label>
          {(
            [
              ["VIT", vit, setVit],
              ["INT", int, setInt],
              ["STR", str, setStr],
              ["DEX", dex, setDex],
              ["X", x, setX],
              ["Y", y, setY],
            ] as const
          ).map(([label, value, setter]) => (
            <label key={label}>
              {label}
              <input
                value={value}
                onChange={(event) => setter(event.target.value)}
                className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              // Send only edited fields so a stale detail snapshot cannot roll
              // back live level, XP or gold the player earned meanwhile.
              const body: Record<string, number> = {};
              const nextLevel = numberValue(level, character.level);
              const nextGold = numberValue(gold, character.gold);
              const nextVit = numberValue(vit, character.stats.vit);
              const nextInt = numberValue(int, character.stats.int);
              const nextStr = numberValue(str, character.stats.str);
              const nextDex = numberValue(dex, character.stats.dex);
              const nextX = numberValue(x, character.x);
              const nextY = numberValue(y, character.y);
              if (nextLevel !== character.level) body.level = nextLevel;
              if (nextGold !== character.gold) body.gold = nextGold;
              if (nextVit !== character.stats.vit) body.statVit = nextVit;
              if (nextInt !== character.stats.int) body.statInt = nextInt;
              if (nextStr !== character.stats.str) body.statStr = nextStr;
              if (nextDex !== character.stats.dex) body.statDex = nextDex;
              if (nextX !== character.x) body.x = nextX;
              if (nextY !== character.y) body.y = nextY;
              if (Object.keys(body).length === 0) {
                setFeedback("No changes to save.");
                return;
              }
              void run("Character update", () => adminApi.updateCharacter(character.id, body));
            }}
            className="rounded bg-[var(--jade)] px-3 py-1 font-semibold text-[#0f1210] disabled:opacity-50"
          >
            Save character
          </button>
          <button
            type="button"
            disabled={busy || !detail.online}
            onClick={() => {
              if (!window.confirm("Teleport this character to Ember Village?")) {
                return;
              }
              void run("Teleport", () => adminApi.teleportTown(character.id));
            }}
            className="rounded border border-[var(--jade-soft)] px-3 py-1 disabled:opacity-40"
          >
            Teleport to town
          </button>
          <button
            type="button"
            disabled={busy || !detail.online}
            onClick={() => {
              if (!window.confirm("Kick this character from the game?")) {
                return;
              }
              void run("Kick", () => adminApi.kick(character.id));
            }}
            className="rounded border border-[#7a3b36] px-3 py-1 text-[#ff8f84] disabled:opacity-40"
          >
            Kick
          </button>
        </div>
      </section>

      <section className="grid gap-2 rounded border border-[#1d2622] p-3">
        <h4 className="font-semibold text-[var(--gold)]">Give item</h4>
        <div className="grid gap-2 sm:grid-cols-[1fr_80px_80px]">
          <select
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
          >
            {ITEMS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({item.id})
              </option>
            ))}
          </select>
          <label>
            Qty
            <input
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
          </label>
          <label>
            Upgrade
            <input
              value={upgrade}
              onChange={(event) => setUpgrade(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
          </label>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_100px]">
          <label>
            Bonus type
            <select
              value={bonusType}
              onChange={(event) => setBonusType(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            >
              {BONUS_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bonus value
            <input
              value={bonusValue}
              onChange={(event) => setBonusValue(event.target.value)}
              className="mt-1 w-full rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run("Item grant", () =>
              adminApi.giveItem(character.id, {
                definitionId: itemId,
                quantity: Math.max(1, numberValue(quantity, 1)),
                upgradeLevel: Math.min(9, Math.max(0, numberValue(upgrade, 0))),
                bonuses:
                  numberValue(bonusValue, 0) !== 0
                    ? [
                        {
                          type: bonusType as (typeof BONUS_TYPES)[number],
                          value: numberValue(bonusValue, 0),
                        },
                      ]
                    : [],
              }),
            )
          }
          className="w-fit rounded bg-[var(--jade)] px-3 py-1 font-semibold text-[#0f1210]"
        >
          Give item
        </button>
      </section>

      <section className="grid gap-2 rounded border border-[#1d2622] p-3">
        <div className="flex items-center justify-between">
          <h4 className="font-semibold text-[var(--gold)]">Ban / unban</h4>
          <span className={banned ? "text-[#ff8f84]" : "text-[#7d8a84]"}>
            {banned ? `Banned until ${account.bannedUntil}` : "Not banned"}
          </span>
        </div>
        {banned ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run("Unban", () => adminApi.unban(account.id))}
              className="w-fit rounded bg-[var(--jade)] px-3 py-1 font-semibold text-[#0f1210]"
            >
              Unban account
            </button>
            <p className="text-[10px] text-[#7d8a84]">
              The player must log in again after an unban (existing tokens stay revoked).
            </p>
          </>
        ) : (
          <div className="grid gap-2 sm:grid-cols-[150px_1fr_auto]">
            <select
              value={banMinutes}
              onChange={(event) => setBanMinutes(event.target.value)}
              className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            >
              <option value="60">1 hour</option>
              <option value="1440">1 day</option>
              <option value="10080">7 days</option>
              <option value="5256000">Permanent</option>
            </select>
            <input
              value={banReason}
              onChange={(event) => setBanReason(event.target.value)}
              placeholder="Reason"
              className="rounded border border-[var(--jade-soft)] bg-[#0e1311] px-2 py-1"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!window.confirm("Ban this account? The player will be kicked immediately.")) {
                  return;
                }
                const minutes = numberValue(banMinutes, 60);
                void run("Ban", () =>
                  adminApi.ban(character.id, {
                    durationMinutes: minutes >= 5_256_000 ? null : minutes,
                    reason: banReason.trim() || undefined,
                  }),
                );
              }}
              className="rounded border border-[#7a3b36] px-3 py-1 text-[#ff8f84]"
            >
              Ban
            </button>
          </div>
        )}
      </section>

      <section className="grid gap-2 rounded border border-[#1d2622] p-3">
        <h4 className="font-semibold text-[var(--gold)]">Owned items</h4>
        {detail.inventory.length === 0 && detail.equipment.every((item) => !item) ? (
          <p className="text-[#7d8a84]">No removable items.</p>
        ) : (
          <div className="grid gap-1">
            {detail.inventory.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2">
                <span>
                  {itemLabel(item.itemId)}
                  {item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : ""}
                </span>
                {removeButton(item, "inventory")}
              </div>
            ))}
            {detail.equipment.map((item, index) =>
              item ? (
                <div key={item.id} className="flex items-center justify-between gap-2">
                  <span>
                    {itemLabel(item.itemId)}
                    {item.upgradeLevel > 0 ? ` +${item.upgradeLevel}` : ""} (slot {index})
                  </span>
                  {removeButton(item, "equipment")}
                </div>
              ) : null,
            )}
          </div>
        )}
        <p className="text-[10px] text-[#7d8a84]">
          Warehouse removal is intentionally not exposed here; use the player's warehouse window.
        </p>
      </section>
    </div>
  );
}
