import { useState } from "react";
import type { AdminCharacterDetail, ItemInstanceDto } from "@jadethrone/shared";
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

  const [itemId, setItemId] = useState("sword_ember_t1");
  const [quantity, setQuantity] = useState("1");
  const [upgrade, setUpgrade] = useState("5");

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

  // Any recorded ban date shows the unban action; expired rows are harmless.
  const banned = account.bannedUntil !== null;

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
          {([
            ["VIT", vit, setVit],
            ["INT", int, setInt],
            ["STR", str, setStr],
            ["DEX", dex, setDex],
          ] as const).map(([label, value, setter]) => (
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
            onClick={() =>
              void run("Character update", () =>
                adminApi.updateCharacter(character.id, {
                  level: numberValue(level, character.level),
                  gold: numberValue(gold, character.gold),
                  statVit: numberValue(vit, character.stats.vit),
                  statInt: numberValue(int, character.stats.int),
                  statStr: numberValue(str, character.stats.str),
                  statDex: numberValue(dex, character.stats.dex),
                }),
              )
            }
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
            disabled={busy}
            onClick={() => {
              if (!window.confirm("Kick this character from the game?")) {
                return;
              }
              void run("Kick", () => adminApi.kick(character.id));
            }}
            className="rounded border border-[#7a3b36] px-3 py-1 text-[#ff8f84]"
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
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run("Item grant", () =>
              adminApi.giveItem(character.id, {
                definitionId: itemId,
                quantity: Math.max(1, numberValue(quantity, 1)),
                upgradeLevel: Math.min(9, Math.max(0, numberValue(upgrade, 0))),
                bonuses: [],
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("Unban", () => adminApi.unban(account.id))}
            className="w-fit rounded bg-[var(--jade)] px-3 py-1 font-semibold text-[#0f1210]"
          >
            Unban account
          </button>
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
