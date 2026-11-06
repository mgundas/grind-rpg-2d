import { describe, expect, it } from "vitest";
import { chatRecipients } from "../src/chat";

const alice = { sessionId: "alice", x: 100, y: 100 };

describe("chatRecipients", () => {
  it("includes the sender and everyone inside the range", () => {
    const participants = [
      alice,
      { sessionId: "near", x: 100 + 899, y: 100 },
      { sessionId: "edge", x: 100, y: 100 + 900 },
      { sessionId: "far", x: 100 + 901, y: 100 },
    ];
    expect(chatRecipients(participants, alice)).toEqual(["alice", "near", "edge"]);
  });

  it("supports a custom range", () => {
    const participants = [alice, { sessionId: "near", x: 150, y: 100 }];
    expect(chatRecipients(participants, alice, 40)).toEqual(["alice"]);
    expect(chatRecipients(participants, alice, 50)).toEqual(["alice", "near"]);
  });

  it("handles an empty participant list", () => {
    expect(chatRecipients([], alice)).toEqual([]);
  });
});
