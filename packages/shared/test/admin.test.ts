import { describe, expect, it } from "vitest";
import {
  adminAnnouncementSchema,
  adminBanSchema,
  adminGiveItemSchema,
  adminLogQuerySchema,
  adminRatesSchema,
  adminSearchQuerySchema,
  adminShutdownSchema,
  adminSpawnSchema,
  adminUpdateCharacterSchema,
} from "../src/admin";

describe("adminGiveItemSchema", () => {
  it("accepts a +5 sword and applies defaults", () => {
    const parsed = adminGiveItemSchema.safeParse({
      definitionId: "sword_ember_t1",
      upgradeLevel: 5,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.quantity).toBe(1);
      expect(parsed.data.upgradeLevel).toBe(5);
      expect(parsed.data.bonuses).toEqual([]);
    }
  });

  it("rejects invalid quantities, upgrades and bonus counts", () => {
    const base = { definitionId: "sword_ember_t1" };
    expect(adminGiveItemSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(adminGiveItemSchema.safeParse({ ...base, quantity: 10_000 }).success).toBe(false);
    expect(adminGiveItemSchema.safeParse({ ...base, upgradeLevel: -1 }).success).toBe(false);
    expect(adminGiveItemSchema.safeParse({ ...base, upgradeLevel: 10 }).success).toBe(false);
    expect(adminGiveItemSchema.safeParse({ ...base, definitionId: "" }).success).toBe(false);
    expect(
      adminGiveItemSchema.safeParse({
        ...base,
        bonuses: Array.from({ length: 6 }, () => ({ type: "max_hp", value: 10 })),
      }).success,
    ).toBe(false);
  });
});

describe("adminUpdateCharacterSchema", () => {
  it("accepts individual fields and rejects an empty patch", () => {
    expect(adminUpdateCharacterSchema.safeParse({ level: 20 }).success).toBe(true);
    expect(adminUpdateCharacterSchema.safeParse({ gold: 0 }).success).toBe(true);
    expect(adminUpdateCharacterSchema.safeParse({ statVit: 90 }).success).toBe(true);
    expect(adminUpdateCharacterSchema.safeParse({}).success).toBe(false);
  });

  it("enforces level, stat, gold and position bounds", () => {
    expect(adminUpdateCharacterSchema.safeParse({ level: 0 }).success).toBe(false);
    expect(adminUpdateCharacterSchema.safeParse({ level: 100 }).success).toBe(false);
    expect(adminUpdateCharacterSchema.safeParse({ statDex: 91 }).success).toBe(false);
    expect(adminUpdateCharacterSchema.safeParse({ gold: -1 }).success).toBe(false);
    expect(adminUpdateCharacterSchema.safeParse({ x: -1 }).success).toBe(false);
    expect(adminUpdateCharacterSchema.safeParse({ y: 70_000 }).success).toBe(false);
  });
});

describe("adminBanSchema", () => {
  it("accepts timed and permanent bans", () => {
    expect(adminBanSchema.safeParse({ durationMinutes: 60 }).success).toBe(true);
    expect(adminBanSchema.safeParse({ durationMinutes: null, reason: "cheating" }).success).toBe(
      true,
    );
  });

  it("rejects zero durations and oversized reasons", () => {
    expect(adminBanSchema.safeParse({ durationMinutes: 0 }).success).toBe(false);
    expect(adminBanSchema.safeParse({ durationMinutes: 10, reason: "x".repeat(201) }).success).toBe(
      false,
    );
  });
});

describe("server-control schemas", () => {
  it("validates rates and spawn counts", () => {
    expect(adminRatesSchema.safeParse({ xpRate: 2, dropRate: 1.5 }).success).toBe(true);
    expect(adminRatesSchema.safeParse({ xpRate: -1, dropRate: 1 }).success).toBe(false);
    expect(adminRatesSchema.safeParse({ xpRate: 101, dropRate: 1 }).success).toBe(false);
    expect(
      adminSpawnSchema.safeParse({ typeId: "wolf_king", count: 1, x: 100, y: 100 }).success,
    ).toBe(true);
    expect(adminSpawnSchema.safeParse({ typeId: "wolf_king", count: 0 }).success).toBe(false);
    expect(adminSpawnSchema.safeParse({ typeId: "wolf_king", count: 51 }).success).toBe(false);
  });

  it("validates shutdown delay and message", () => {
    expect(adminShutdownSchema.safeParse({ delayMinutes: 30, message: "Back soon" }).success).toBe(
      true,
    );
    expect(adminShutdownSchema.safeParse({ delayMinutes: 0, message: "x" }).success).toBe(false);
    expect(adminShutdownSchema.safeParse({ delayMinutes: 30, message: "" }).success).toBe(false);
  });

  it("accepts one-off and recurring announcements", () => {
    expect(adminAnnouncementSchema.safeParse({ message: "Hello" }).success).toBe(true);
    expect(
      adminAnnouncementSchema.safeParse({
        message: "Hello",
        intervalMinutes: 30,
        expiresInMinutes: 120,
      }).success,
    ).toBe(true);
    expect(adminAnnouncementSchema.safeParse({ message: "" }).success).toBe(false);
    expect(adminAnnouncementSchema.safeParse({ message: "x", intervalMinutes: 0 }).success).toBe(
      false,
    );
  });
});

describe("admin query schemas", () => {
  it("coerces pagination from query strings", () => {
    const parsed = adminSearchQuerySchema.safeParse({ q: "hero", limit: "10", offset: "20" });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.limit).toBe(10);
      expect(parsed.data.offset).toBe(20);
    }
  });

  it("validates log filters", () => {
    expect(
      adminLogQuerySchema.safeParse({
        q: "sword",
        from: "2026-01-01T00:00:00.000Z",
        limit: "100",
      }).success,
    ).toBe(true);
    expect(adminLogQuerySchema.safeParse({ characterId: "not-a-uuid" }).success).toBe(false);
    expect(adminLogQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
  });
});
