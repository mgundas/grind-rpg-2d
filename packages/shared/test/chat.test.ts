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

import { parseChatInput, scrambleChatText } from "../src/chat";

describe("chat input parsing", () => {
  it("parses every channel prefix and defaults to local", () => {
    expect(parseChatInput("hello")).toEqual({ channel: "local", body: "hello" });
    expect(parseChatInput("/s storm")).toEqual({ channel: "shout", body: "storm" });
    expect(parseChatInput("/shout storm")).toEqual({ channel: "shout", body: "storm" });
    expect(parseChatInput("/p help")).toEqual({ channel: "party", body: "help" });
    expect(parseChatInput("/g rally")).toEqual({ channel: "guild", body: "rally" });
    expect(parseChatInput("/w Bob hi there")).toEqual({
      channel: "whisper",
      targetName: "Bob",
      body: "hi there",
    });
  });

  it("leaves malformed commands as local text", () => {
    expect(parseChatInput("/w Bob")).toEqual({ channel: "local", body: "/w Bob" });
    expect(parseChatInput("/unknown hi")).toEqual({ channel: "local", body: "/unknown hi" });
  });
});

describe("scrambleChatText", () => {
  it("shuffles letters and digits deterministically while preserving layout", () => {
    const original = "Hello, fellow 42 travellers!";
    const once = scrambleChatText(original, 7);
    const twice = scrambleChatText(original, 7);
    expect(once).toBe(twice);
    expect(once).not.toBe(original);
    expect(once).toHaveLength(original.length);
    expect(once.match(/[^A-Za-z0-9]/g)).toEqual(original.match(/[^A-Za-z0-9]/g));
    expect([...once].sort()).toEqual([...original].sort());
  });

  it("leaves very short messages alone", () => {
    expect(scrambleChatText("hi", 3)).toBe("hi");
  });
});
