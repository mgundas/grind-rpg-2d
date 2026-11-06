import { describe, expect, it } from "vitest";
import miniMap from "./fixtures/mini-map.json";
import { buildCollisionGrid, rectOverlapsSolid } from "../src/collision";
import { createMover, stepMover, type MoveIntent } from "../src/movement";
import { parseTiledMap } from "../src/tiled";
import { INV_SQRT2, WALK_SPEED } from "../src/constants";

const grid = buildCollisionGrid(parseTiledMap(structuredClone(miniMap)));
const TICK_MS = 50;

function tick(mover: ReturnType<typeof createMover>, intent: MoveIntent, times = 1) {
  let state = mover;
  for (let i = 0; i < times; i++) {
    state = stepMover(state, intent, grid, TICK_MS);
  }
  return state;
}

describe("stepMover", () => {
  it("is deterministic for identical inputs", () => {
    let a = createMover({ x: 48, y: 48 });
    let b = createMover({ x: 48, y: 48 });
    const intents: MoveIntent[] = [
      { kind: "dir", dir: 2 },
      { kind: "dir", dir: 1 },
      { kind: "dir", dir: 0 },
      { kind: "none" },
      { kind: "dir", dir: 6 },
    ];
    for (const intent of intents) {
      a = stepMover(a, intent, grid, TICK_MS);
      b = stepMover(b, intent, grid, TICK_MS);
    }
    expect(a).toEqual(b);
  });

  it("does not mutate the input mover", () => {
    const mover = createMover({ x: 48, y: 48 });
    const before = JSON.parse(JSON.stringify(mover)) as typeof mover;
    stepMover(mover, { kind: "dir", dir: 0 }, grid, TICK_MS);
    expect(mover).toEqual(before);
  });

  it("moves exactly walkSpeed * dt on an axis", () => {
    const state = tick(createMover({ x: 48, y: 48 }), { kind: "dir", dir: 0 });
    expect(state.pos.x).toBeCloseTo(48 + WALK_SPEED * 0.05, 10);
    expect(state.pos.y).toBeCloseTo(48, 10);
  });

  it("moves diagonals at the same speed", () => {
    const state = tick(createMover({ x: 48, y: 48 }), { kind: "dir", dir: 1 });
    const step = WALK_SPEED * 0.05;
    expect(state.pos.x).toBeCloseTo(48 + step * INV_SQRT2, 10);
    expect(state.pos.y).toBeCloseTo(48 + step * INV_SQRT2, 10);
    const dx = state.pos.x - 48;
    const dy = state.pos.y - 48;
    expect(Math.hypot(dx, dy)).toBeCloseTo(step, 10);
  });

  it("does nothing for the none intent or a zero delta", () => {
    const moved = tick(createMover({ x: 48, y: 48 }), { kind: "dir", dir: 0 }, 3);
    expect(tick(moved, { kind: "none" })).toEqual(moved);
    expect(stepMover(moved, { kind: "dir", dir: 4 }, grid, 0)).toEqual(moved);
  });

  it("stops at the border without penetrating it", () => {
    // Row 1 is free from tile 1 to 6; the border at tile 0 is solid.
    const state = tick(createMover({ x: 100, y: 48 }), { kind: "dir", dir: 4 }, 10);
    expect(state.pos.x).toBeCloseTo(50, 10);
    expect(rectOverlapsSolid(grid, state.pos.x, state.pos.y)).toBe(false);
  });

  it("slides along a wall when the other axis is blocked", () => {
    // Start hugging the west border: body left edge sits exactly at x=32.
    const start = { x: 42, y: 48 };
    const state = tick(createMover(start), { kind: "dir", dir: 3 }, 4);
    expect(state.pos.x).toBeCloseTo(42, 10);
    expect(state.pos.y).toBeGreaterThan(start.y);
    expect(rectOverlapsSolid(grid, state.pos.x, state.pos.y)).toBe(false);
  });

  it("stops diagonally at the inner block instead of clipping", () => {
    let state = createMover({ x: 80, y: 80 });
    for (let i = 0; i < 5; i++) {
      state = stepMover(state, { kind: "dir", dir: 1 }, grid, TICK_MS);
      expect(rectOverlapsSolid(grid, state.pos.x, state.pos.y)).toBe(false);
    }
    // Y stops at the block's top edge (96 - 6px half-height) while X keeps
    // sliding east along it.
    expect(state.pos.y).toBeLessThanOrEqual(90.0001);
    expect(state.pos.y).toBeGreaterThan(80);
    expect(state.pos.x).toBeGreaterThan(100);

    // Continuing around the corner stays collision-free the whole way.
    for (let i = 0; i < 20; i++) {
      state = stepMover(state, { kind: "dir", dir: 1 }, grid, TICK_MS);
      expect(rectOverlapsSolid(grid, state.pos.x, state.pos.y)).toBe(false);
    }
  });

  it("clears a stored path when a direction intent arrives", () => {
    const mover = { pos: { x: 48, y: 48 }, path: [{ x: 200, y: 48 }] };
    const state = stepMover(mover, { kind: "dir", dir: 0 }, grid, TICK_MS);
    expect(state.path).toEqual([]);
  });

  describe("path following", () => {
    it("walks toward the first waypoint and consumes it", () => {
      let state: ReturnType<typeof createMover> = {
        pos: { x: 48, y: 48 },
        path: [
          { x: 80, y: 48 },
          { x: 112, y: 48 },
        ],
      };
      for (let i = 0; i < 3; i++) {
        state = stepMover(state, { kind: "path" }, grid, TICK_MS);
      }
      expect(state.pos.x).toBeGreaterThan(48);
      expect(state.path.length).toBeLessThan(2);
    });

    it("arrives at the final waypoint without oscillating", () => {
      let state: ReturnType<typeof createMover> = {
        pos: { x: 48, y: 48 },
        path: [{ x: 112, y: 48 }],
      };
      for (let i = 0; i < 20; i++) {
        state = stepMover(state, { kind: "path" }, grid, TICK_MS);
      }
      expect(state.path).toEqual([]);
      const stop = state.pos.x;
      state = stepMover(state, { kind: "path" }, grid, TICK_MS);
      expect(state.pos.x).toBe(stop);
    });

    it("does not move when the path is empty", () => {
      const state = stepMover(createMover({ x: 48, y: 48 }), { kind: "path" }, grid, TICK_MS);
      expect(state.pos).toEqual({ x: 48, y: 48 });
    });

    it("consumes a waypoint that the next step would cross", () => {
      const state = stepMover(
        { pos: { x: 48, y: 48 }, path: [{ x: 53, y: 48 }] },
        { kind: "path" },
        grid,
        TICK_MS,
      );
      expect(state.path).toEqual([]);
      expect(state.pos).toEqual({ x: 53, y: 48 });
    });
  });
});
