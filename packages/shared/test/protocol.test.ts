import { describe, expect, it } from "vitest";
import { CHAT_MAX_LEN, MAX_GOLD } from "../src/constants";
import {
  allocStatMessageSchema,
  applyBonusScrollMessageSchema,
  attackMessageSchema,
  chatMessageSchema,
  equipItemMessageSchema,
  inputMessageSchema,
  interactNpcMessageSchema,
  moveItemMessageSchema,
  pickupMessageSchema,
  requestInventoryMessageSchema,
  requestUpgradePreviewMessageSchema,
  respawnMessageSchema,
  setTargetMessageSchema,
  shopBuyMessageSchema,
  shopSellMessageSchema,
  splitStackMessageSchema,
  tradeAcceptMessageSchema,
  tradeCancelMessageSchema,
  tradeInviteMessageSchema,
  tradeLockMessageSchema,
  tradeOfferMessageSchema,
  tradeRespondMessageSchema,
  friendAddMessageSchema,
  friendRemoveMessageSchema,
  guildCreateMessageSchema,
  guildInviteMessageSchema,
  guildRespondMessageSchema,
  guildSetRankMessageSchema,
  unequipItemMessageSchema,
  upgradeItemMessageSchema,
  useItemMessageSchema,
  warehouseDepositMessageSchema,
  warehouseOpenMessageSchema,
  warehouseWithdrawMessageSchema,
} from "../src/protocol";

describe("inputMessageSchema", () => {
  it("accepts every direction and the three intent kinds", () => {
    for (let dir = 0; dir <= 7; dir++) {
      expect(inputMessageSchema.safeParse({ seq: 1, kind: "dir", dir }).success).toBe(true);
    }
    expect(inputMessageSchema.safeParse({ seq: 2, kind: "path", x: 0, y: 65535 }).success).toBe(
      true,
    );
    expect(inputMessageSchema.safeParse({ seq: 3, kind: "none" }).success).toBe(true);
  });

  it("rejects out-of-range and non-integer sequences", () => {
    for (const seq of [0, -1, 1.5, 4_294_967_296]) {
      expect(inputMessageSchema.safeParse({ seq, kind: "none" }).success).toBe(false);
    }
  });

  it("rejects out-of-range directions", () => {
    for (const dir of [-1, 8, 2.5]) {
      expect(inputMessageSchema.safeParse({ seq: 1, kind: "dir", dir }).success).toBe(false);
    }
  });

  it("rejects non-finite or out-of-range path coordinates", () => {
    for (const point of [
      { x: -1, y: 10 },
      { x: 10, y: -1 },
      { x: 65_536, y: 10 },
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.POSITIVE_INFINITY },
    ]) {
      expect(inputMessageSchema.safeParse({ seq: 1, kind: "path", ...point }).success).toBe(false);
    }
  });

  it("rejects unknown intent kinds and extra required fields", () => {
    expect(inputMessageSchema.safeParse({ seq: 1, kind: "jump" }).success).toBe(false);
    expect(inputMessageSchema.safeParse({ kind: "none" }).success).toBe(false);
  });
});

describe("combat message schemas", () => {
  it("accepts an attack with or without a direction", () => {
    expect(attackMessageSchema.safeParse({}).success).toBe(true);
    for (let dir = 0; dir <= 7; dir++) {
      expect(attackMessageSchema.safeParse({ dir }).success).toBe(true);
    }
    for (const dir of [-1, 8, 2.5, "2"]) {
      expect(attackMessageSchema.safeParse({ dir }).success).toBe(false);
    }
  });

  it("validates a setTarget monster id", () => {
    expect(setTargetMessageSchema.safeParse({ monsterId: "m0_g1_2" }).success).toBe(true);
    expect(setTargetMessageSchema.safeParse({ monsterId: "" }).success).toBe(false);
    expect(setTargetMessageSchema.safeParse({ monsterId: "x".repeat(65) }).success).toBe(false);
    expect(setTargetMessageSchema.safeParse({ monsterId: 7 }).success).toBe(false);
  });

  it("accepts only the two respawn options", () => {
    expect(respawnMessageSchema.safeParse({ option: "here" }).success).toBe(true);
    expect(respawnMessageSchema.safeParse({ option: "town" }).success).toBe(true);
    expect(respawnMessageSchema.safeParse({ option: "somewhere" }).success).toBe(false);
  });

  it("accepts only the four stat keys", () => {
    for (const stat of ["vit", "int", "str", "dex"]) {
      expect(allocStatMessageSchema.safeParse({ stat }).success).toBe(true);
    }
    for (const stat of ["luck", "", 1, null]) {
      expect(allocStatMessageSchema.safeParse({ stat }).success).toBe(false);
    }
  });
});

describe("Phase 4 item/economy message schemas", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("accepts a requestInventory message", () => {
    expect(requestInventoryMessageSchema.safeParse({}).success).toBe(true);
  });

  it("validates moveItem slots and UUIDs", () => {
    expect(moveItemMessageSchema.safeParse({ instanceId: id, toSlot: 0 }).success).toBe(true);
    expect(moveItemMessageSchema.safeParse({ instanceId: id, toSlot: 89 }).success).toBe(true);
    expect(moveItemMessageSchema.safeParse({ instanceId: id, toSlot: 90 }).success).toBe(false);
    expect(moveItemMessageSchema.safeParse({ instanceId: "not-a-uuid", toSlot: 0 }).success).toBe(
      false,
    );
    expect(moveItemMessageSchema.safeParse({ instanceId: id }).success).toBe(false);
  });

  it("validates split quantities and optional destination", () => {
    expect(splitStackMessageSchema.safeParse({ instanceId: id, quantity: 1 }).success).toBe(true);
    expect(splitStackMessageSchema.safeParse({ instanceId: id, quantity: 5, toSlot: null }).success).toBe(
      true,
    );
    expect(splitStackMessageSchema.safeParse({ instanceId: id, quantity: 0 }).success).toBe(false);
    expect(splitStackMessageSchema.safeParse({ instanceId: id, quantity: 1.5 }).success).toBe(false);
  });

  it("validates equip, unequip and use messages", () => {
    expect(equipItemMessageSchema.safeParse({ instanceId: id }).success).toBe(true);
    expect(useItemMessageSchema.safeParse({ instanceId: id }).success).toBe(true);
    expect(unequipItemMessageSchema.safeParse({ slot: 0 }).success).toBe(true);
    expect(unequipItemMessageSchema.safeParse({ slot: 7 }).success).toBe(true);
    expect(unequipItemMessageSchema.safeParse({ slot: 8 }).success).toBe(false);
  });

  it("validates pickup, NPC and shop messages", () => {
    expect(pickupMessageSchema.safeParse({ dropId: id }).success).toBe(true);
    expect(pickupMessageSchema.safeParse({ dropId: "x" }).success).toBe(false);
    expect(interactNpcMessageSchema.safeParse({ npcId: "general_goods" }).success).toBe(true);
    expect(interactNpcMessageSchema.safeParse({ npcId: "" }).success).toBe(false);
    expect(
      shopBuyMessageSchema.safeParse({ shopId: "general_goods", itemId: "potion_hp_s", quantity: 5 })
        .success,
    ).toBe(true);
    expect(
      shopBuyMessageSchema.safeParse({ shopId: "general_goods", itemId: "potion_hp_s", quantity: 0 })
        .success,
    ).toBe(false);
    expect(shopSellMessageSchema.safeParse({ instanceId: id, quantity: 3 }).success).toBe(true);
  });

  it("validates warehouse messages", () => {
    expect(warehouseOpenMessageSchema.safeParse({ npcId: "warehouse_keeper" }).success).toBe(true);
    expect(warehouseDepositMessageSchema.safeParse({ instanceId: id }).success).toBe(true);
    expect(warehouseWithdrawMessageSchema.safeParse({ instanceId: id, toSlot: 3 }).success).toBe(
      true,
    );
    expect(warehouseWithdrawMessageSchema.safeParse({ instanceId: id, toSlot: 90 }).success).toBe(
      false,
    );
  });

  it("validates blacksmith preview and upgrade messages", () => {
    expect(requestUpgradePreviewMessageSchema.safeParse({ instanceId: id }).success).toBe(true);
    expect(requestUpgradePreviewMessageSchema.safeParse({ instanceId: "nope" }).success).toBe(false);
    expect(requestUpgradePreviewMessageSchema.safeParse({ instanceId: id, extra: 1 }).success).toBe(
      false,
    );
    expect(
      upgradeItemMessageSchema.safeParse({ instanceId: id, useBlessing: true }).success,
    ).toBe(true);
    expect(
      upgradeItemMessageSchema.safeParse({ instanceId: id, useBlessing: false }).success,
    ).toBe(true);
    expect(upgradeItemMessageSchema.safeParse({ instanceId: id }).success).toBe(false);
    expect(
      upgradeItemMessageSchema.safeParse({ instanceId: id, useBlessing: "yes" }).success,
    ).toBe(false);
  });

  it("validates bonus scroll application", () => {
    expect(
      applyBonusScrollMessageSchema.safeParse({
        scrollInstanceId: id,
        itemInstanceId: "22222222-2222-4222-8222-222222222222",
      }).success,
    ).toBe(true);
    expect(
      applyBonusScrollMessageSchema.safeParse({ scrollInstanceId: id }).success,
    ).toBe(false);
    expect(
      applyBonusScrollMessageSchema.safeParse({
        scrollInstanceId: "nope",
        itemInstanceId: id,
      }).success,
    ).toBe(false);
    expect(
      applyBonusScrollMessageSchema.safeParse({
        scrollInstanceId: id,
        itemInstanceId: "22222222-2222-4222-8222-222222222222",
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("chatMessageSchema", () => {
  it("trims surrounding whitespace", () => {
    const parsed = chatMessageSchema.safeParse({ text: "  hello  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.text).toBe("hello");
    }
  });

  it("accepts exactly the maximum length and rejects one more", () => {
    expect(chatMessageSchema.safeParse({ text: "x".repeat(CHAT_MAX_LEN) }).success).toBe(true);
    expect(chatMessageSchema.safeParse({ text: "x".repeat(CHAT_MAX_LEN + 1) }).success).toBe(false);
  });

  it("rejects empty and whitespace-only messages", () => {
    expect(chatMessageSchema.safeParse({ text: "" }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ text: "   " }).success).toBe(false);
  });

  it("rejects non-string payloads", () => {
    expect(chatMessageSchema.safeParse({ text: 42 }).success).toBe(false);
    expect(chatMessageSchema.safeParse(null).success).toBe(false);
  });

  it("validates channel and whisper target rules", () => {
    const local = chatMessageSchema.safeParse({ text: "hi" });
    expect(local.success).toBe(true);
    if (local.success) {
      expect(local.data.channel).toBe("local");
    }
    expect(chatMessageSchema.safeParse({ text: "hi", channel: "shout" }).success).toBe(true);
    expect(
      chatMessageSchema.safeParse({ text: "hi", channel: "whisper", targetName: "Bob" }).success,
    ).toBe(true);
    expect(chatMessageSchema.safeParse({ text: "hi", channel: "whisper" }).success).toBe(false);
    expect(
      chatMessageSchema.safeParse({ text: "hi", channel: "local", targetName: "Bob" }).success,
    ).toBe(false);
    expect(chatMessageSchema.safeParse({ text: "hi", channel: "trade" }).success).toBe(false);
  });
});

describe("guild message schemas", () => {
  const inviteId = "66666666-6666-4666-8666-666666666666";
  const characterId = "77777777-7777-4777-8777-777777777777";

  it("validates guild creation and invites", () => {
    expect(guildCreateMessageSchema.safeParse({ name: "Jade" }).success).toBe(true);
    expect(guildCreateMessageSchema.safeParse({ name: "" }).success).toBe(false);
    expect(guildInviteMessageSchema.safeParse({ characterId }).success).toBe(true);
    expect(guildInviteMessageSchema.safeParse({ name: "Alice" }).success).toBe(true);
    expect(guildInviteMessageSchema.safeParse({}).success).toBe(false);
  });

  it("validates guild responses and rank changes", () => {
    expect(guildRespondMessageSchema.safeParse({ inviteId, accept: true }).success).toBe(true);
    expect(guildRespondMessageSchema.safeParse({ inviteId }).success).toBe(false);
    expect(
      guildSetRankMessageSchema.safeParse({ characterId, rank: "officer" }).success,
    ).toBe(true);
    expect(
      guildSetRankMessageSchema.safeParse({ characterId, rank: "leader" }).success,
    ).toBe(false);
  });
});

describe("friend message schemas", () => {
  const id = "55555555-5555-4555-8555-555555555555";

  it("accepts id or name adds and rejects empty payloads", () => {
    expect(friendAddMessageSchema.safeParse({ characterId: id }).success).toBe(true);
    expect(friendAddMessageSchema.safeParse({ name: "Alice" }).success).toBe(true);
    expect(friendAddMessageSchema.safeParse({}).success).toBe(false);
    expect(friendAddMessageSchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("validates remove/state payloads", () => {
    expect(friendRemoveMessageSchema.safeParse({ characterId: id }).success).toBe(true);
    expect(friendRemoveMessageSchema.safeParse({ characterId: "nope" }).success).toBe(false);
  });
});

describe("trade message schemas", () => {
  const tradeId = "33333333-3333-4333-8333-333333333333";
  const itemId = "44444444-4444-4444-8444-444444444444";

  it("validates invites and responses", () => {
    expect(tradeInviteMessageSchema.safeParse({ characterId: itemId }).success).toBe(true);
    expect(tradeInviteMessageSchema.safeParse({ characterId: "nope" }).success).toBe(false);
    expect(tradeInviteMessageSchema.safeParse({ characterId: itemId, extra: 1 }).success).toBe(
      false,
    );
    expect(tradeRespondMessageSchema.safeParse({ tradeId, accept: true }).success).toBe(true);
    expect(tradeRespondMessageSchema.safeParse({ tradeId, accept: "yes" }).success).toBe(false);
  });

  it("validates offers, duplicates, gold and revision", () => {
    expect(
      tradeOfferMessageSchema.safeParse({
        tradeId,
        revision: 0,
        instanceIds: [itemId],
        gold: 500,
      }).success,
    ).toBe(true);
    expect(
      tradeOfferMessageSchema.safeParse({
        tradeId,
        revision: 0,
        instanceIds: [itemId, itemId],
        gold: 0,
      }).success,
    ).toBe(false);
    for (const gold of [-1, 1.5, MAX_GOLD + 1]) {
      expect(
        tradeOfferMessageSchema.safeParse({
          tradeId,
          revision: 0,
          instanceIds: [],
          gold,
        }).success,
      ).toBe(false);
    }
    expect(
      tradeOfferMessageSchema.safeParse({
        tradeId,
        revision: -1,
        instanceIds: [],
        gold: 0,
      }).success,
    ).toBe(false);
    expect(
      tradeOfferMessageSchema.safeParse({
        tradeId,
        revision: 0,
        instanceIds: Array.from({ length: 91 }, () => itemId),
        gold: 0,
      }).success,
    ).toBe(false);
  });

  it("validates lock, accept and cancel messages", () => {
    expect(
      tradeLockMessageSchema.safeParse({ tradeId, revision: 3, locked: true }).success,
    ).toBe(true);
    expect(
      tradeLockMessageSchema.safeParse({ tradeId, revision: 3, locked: "yes" }).success,
    ).toBe(false);
    expect(tradeAcceptMessageSchema.safeParse({ tradeId, revision: 3 }).success).toBe(true);
    expect(tradeAcceptMessageSchema.safeParse({ tradeId }).success).toBe(false);
    expect(tradeCancelMessageSchema.safeParse({ tradeId }).success).toBe(true);
    expect(tradeCancelMessageSchema.safeParse({}).success).toBe(false);
  });
});
