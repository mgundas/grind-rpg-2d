import { describe, expect, it } from "vitest";
import { CHAT_MAX_LEN } from "../src/constants";
import {
  allocStatMessageSchema,
  attackMessageSchema,
  chatMessageSchema,
  inputMessageSchema,
  respawnMessageSchema,
  setTargetMessageSchema,
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
});
