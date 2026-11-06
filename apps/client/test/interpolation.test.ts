import { describe, expect, it } from "vitest";
import { SampleBuffer } from "../src/state/remotes";

describe("SampleBuffer", () => {
  it("interpolates between bracketing samples", () => {
    const buffer = new SampleBuffer();
    buffer.push(1000, 0, 0);
    buffer.push(1100, 100, 40);
    expect(buffer.sample(1050)).toEqual({ x: 50, y: 20 });
    expect(buffer.sample(1000)).toEqual({ x: 0, y: 0 });
    expect(buffer.sample(1100)).toEqual({ x: 100, y: 40 });
  });

  it("clamps before the oldest sample and holds the newest", () => {
    const buffer = new SampleBuffer();
    buffer.push(1000, 10, 10);
    buffer.push(1050, 60, 10);
    expect(buffer.sample(500)).toEqual({ x: 10, y: 10 });
    expect(buffer.sample(5000)).toEqual({ x: 60, y: 10 });
  });

  it("keeps the latest position when a burst shares one receipt timestamp", () => {
    const buffer = new SampleBuffer();
    buffer.push(1000, 0, 0);
    buffer.push(1000, 10, 0);
    buffer.push(1000, 20, 0);
    expect(buffer.size).toBe(1);
    expect(buffer.sample(1000)).toEqual({ x: 20, y: 0 });

    buffer.push(1050, 30, 0);
    expect(buffer.sample(1025)).toEqual({ x: 25, y: 0 });
  });

  it("drops out-of-order samples", () => {
    const buffer = new SampleBuffer();
    buffer.push(1000, 0, 0);
    buffer.push(1100, 100, 0);
    buffer.push(1050, 999, 999);
    expect(buffer.sample(1100)).toEqual({ x: 100, y: 0 });
    expect(buffer.size).toBe(2);
  });

  it("clears the buffer on a teleport beyond 200 px", () => {
    const buffer = new SampleBuffer();
    buffer.push(1000, 0, 0);
    buffer.push(1050, 10, 0);
    buffer.push(1100, 400, 0);
    expect(buffer.size).toBe(1);
    expect(buffer.sample(1100)).toEqual({ x: 400, y: 0 });
  });

  it("keeps a bounded capacity", () => {
    const buffer = new SampleBuffer(4);
    for (let i = 0; i < 20; i++) {
      buffer.push(1000 + i, i * 10, 0);
    }
    expect(buffer.size).toBe(4);
    expect(buffer.sample(1019)).toEqual({ x: 190, y: 0 });
  });

  it("returns null while empty", () => {
    expect(new SampleBuffer().sample(1000)).toBeNull();
  });
});
