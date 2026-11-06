import { describe, expect, it } from "vitest";
import {
  TICK_MS,
  createMover,
  findPath,
  stepMover,
  type CollisionGrid,
  type InputMessage,
} from "@jadethrone/shared";
import { LocalPredictor, type DesiredInput } from "../src/state/predictor";

function openGrid(width = 40, height = 40): CollisionGrid {
  return { width, height, tileSize: 32, solid: new Uint8Array(width * height) };
}

/** Minimal virtual server: applies each sent intent once, no grace ticks. */
function createVirtualServer(grid: CollisionGrid, start: { x: number; y: number }) {
  let mover = createMover(start);
  let applied = 0;
  const sent: InputMessage[] = [];

  return {
    sent,
    get position() {
      return mover.pos;
    },
    get applied() {
      return applied;
    },
    send(message: InputMessage) {
      sent.push(message);
    },
    applyUntil(seq: number) {
      while (applied < seq) {
        const message = sent[applied];
        if (!message) {
          throw new Error(`missing sent input ${applied + 1}`);
        }
        applied++;
        mover = apply(grid, mover, message);
      }
      return mover.pos;
    },
  };
}

function apply(
  grid: CollisionGrid,
  mover: ReturnType<typeof createMover>,
  message: InputMessage,
): ReturnType<typeof createMover> {
  if (message.kind === "dir") {
    return stepMover(
      { pos: mover.pos, path: [] },
      { kind: "dir", dir: message.dir as 0 },
      grid,
      TICK_MS,
    );
  }
  if (message.kind === "path") {
    const path = findPath(grid, mover.pos, { x: message.x, y: message.y });
    return stepMover({ pos: mover.pos, path }, { kind: "path" }, grid, TICK_MS);
  }
  return stepMover({ pos: mover.pos, path: [] }, { kind: "none" }, grid, TICK_MS);
}

describe("LocalPredictor", () => {
  it("interpolates the render position between fixed simulation ticks", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));
    const input: DesiredInput = { kind: "dir", dir: 0 };

    predictor.update(TICK_MS, input);
    expect(predictor.position.x).toBe(110);
    expect(predictor.visualPosition.x).toBeCloseTo(100, 6);

    const rendered = [predictor.visualPosition.x];
    for (let i = 0; i < 4; i++) {
      predictor.update(10, input);
      rendered.push(predictor.visualPosition.x);
      expect(predictor.position.x).toBe(110);
    }
    rendered.forEach((x, index) => expect(x).toBeCloseTo(100 + index * 2, 6));
    for (let i = 1; i < rendered.length; i++) {
      expect(rendered[i]!).toBeGreaterThan(rendered[i - 1]!);
    }

    predictor.update(9, input);
    expect(predictor.visualPosition.x).toBeCloseTo(109.8, 6);
    expect(server.sent).toHaveLength(1);
    predictor.update(1, input);
    expect(predictor.position.x).toBe(120);
    expect(predictor.visualPosition.x).toBeCloseTo(110, 6);
    expect(server.sent).toHaveLength(2);
  });

  it("keeps fractional-tick rendering continuous through reconciliation", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));
    const input: DesiredInput = { kind: "dir", dir: 0 };

    predictor.update(TICK_MS, input);
    predictor.update(TICK_MS, input);
    predictor.update(TICK_MS / 2, input);
    expect(predictor.visualPosition.x).toBeCloseTo(115, 6);

    const before = predictor.visualPosition;
    const authoritative = server.applyUntil(1);
    const result = predictor.reconcile(authoritative.x + 4, authoritative.y, 1);

    expect(result.snapped).toBe(false);
    expect(predictor.position.x).toBe(124);
    expect(predictor.visualPosition.x).toBeCloseTo(before.x, 6);
    expect(predictor.visualPosition.y).toBeCloseTo(before.y, 6);

    predictor.update(10, input);
    expect(predictor.visualPosition.x).toBeGreaterThan(before.x);
    expect(predictor.visualPosition.x).toBeLessThan(predictor.position.x);
  });

  it("stays in sync under a 2-tick ack lag (no false snaps)", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));

    const intents: DesiredInput[] = [
      { kind: "dir", dir: 0 },
      { kind: "dir", dir: 0 },
      { kind: "dir", dir: 1 },
      { kind: "dir", dir: 2 },
      { kind: "dir", dir: 4 },
      { kind: "none" },
      { kind: "dir", dir: 7 },
    ];

    let snaps = 0;
    for (let i = 0; i < 40; i++) {
      const intent = intents[i % intents.length]!;
      predictor.update(TICK_MS, intent);
      const ack = Math.max(1, server.sent.length - 2);
      const authoritative = server.applyUntil(ack);
      const result = predictor.reconcile(authoritative.x, authoritative.y, ack);
      expect(result.errorPx).toBeCloseTo(0, 6);
      if (result.snapped) {
        snaps++;
      }
    }
    expect(snaps).toBe(0);
  });

  it("snaps when the authoritative position diverges by more than 64 px", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));

    for (let i = 0; i < 5; i++) {
      predictor.update(TICK_MS, { kind: "dir", dir: 0 });
    }
    const ack = server.sent.length;
    const authoritative = server.applyUntil(ack);
    const result = predictor.reconcile(authoritative.x + 200, authoritative.y, ack);

    expect(result.snapped).toBe(true);
    expect(predictor.snaps).toBe(1);
    expect(predictor.visualPosition).toEqual(predictor.position);
  });

  it("keeps the visual position continuous for small corrections", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));

    for (let i = 0; i < 5; i++) {
      predictor.update(TICK_MS, { kind: "dir", dir: 0 });
    }
    const before = predictor.visualPosition;
    const ack = server.sent.length;
    const authoritative = server.applyUntil(ack);
    const result = predictor.reconcile(authoritative.x + 20, authoritative.y, ack);

    expect(result.snapped).toBe(false);
    expect(predictor.visualPosition.x).toBeCloseTo(before.x, 6);
    expect(predictor.visualPosition.y).toBeCloseTo(before.y, 6);

    // The offset decays over ~100 ms without changing the auth position.
    for (let i = 0; i < 3; i++) {
      predictor.update(TICK_MS, { kind: "none" });
    }
    expect(predictor.visualPosition.x).toBeCloseTo(predictor.position.x, 6);
  });

  it("measures error against the prediction, not the decaying visual offset", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));

    for (let i = 0; i < 5; i++) {
      predictor.update(TICK_MS, { kind: "dir", dir: 0 });
    }
    const ack = server.sent.length;
    const authoritative = server.applyUntil(ack);

    // A 60 px correction leaves a large visual offset that is still decaying.
    const first = predictor.reconcile(authoritative.x + 60, authoritative.y, ack);
    expect(first.snapped).toBe(false);

    // A small 10 px prediction correction must not be added to the offset and
    // mistaken for a 70 px divergence.
    const second = predictor.reconcile(authoritative.x + 70, authoritative.y, ack + 1);
    expect(second.snapped).toBe(false);
    expect(second.errorPx).toBeCloseTo(10, 6);
    expect(predictor.snaps).toBe(0);
  });

  it("caps the unacknowledged history", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));
    for (let i = 0; i < 100; i++) {
      predictor.update(TICK_MS, { kind: "dir", dir: 0 });
    }
    expect(predictor.pendingInputs).toBeLessThanOrEqual(64);
  });

  it("sends idle none only once", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));
    for (let i = 0; i < 20; i++) {
      predictor.update(TICK_MS, { kind: "none" });
    }
    expect(server.sent).toHaveLength(1);
    expect(server.sent[0]).toEqual({ seq: 1, kind: "none" });
  });

  it("follows a click-to-move path and reports arrival", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));
    const target = { x: 300, y: 100 };

    for (let i = 0; i < 60 && (i === 0 || predictor.isFollowingPath); i++) {
      predictor.update(TICK_MS, { kind: "path", x: target.x, y: target.y });
    }
    expect(predictor.isFollowingPath).toBe(false);
    expect(predictor.position.x).toBeCloseTo(target.x, 0);
    expect(predictor.position.y).toBeCloseTo(target.y, 0);
  });

  it("reseeds the input sequence after server-driven auto-walk", () => {
    const grid = openGrid();
    const server = createVirtualServer(grid, { x: 100, y: 100 });
    const predictor = new LocalPredictor(grid, { x: 100, y: 100 }, (m) => server.send(m));
    predictor.update(TICK_MS, { kind: "none" });
    expect(server.sent[0]?.seq).toBe(1);

    predictor.resetAt({ x: 250, y: 100 }, 42);
    predictor.update(TICK_MS, { kind: "dir", dir: 0 });

    expect(server.sent[server.sent.length - 1]?.seq).toBe(43);
    expect(predictor.position.x).toBeGreaterThan(250);
  });
});
