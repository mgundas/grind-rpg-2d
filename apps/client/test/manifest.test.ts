import { describe, expect, it } from "vitest";
import { parseAssetManifest } from "../src/assets/manifest";

/** Guards the phase-0 acceptance rule: /bad manifest → readable error/. */
const validEntry = {
  path: "tilesets/village.png",
  placeholder: { kind: "tileset", tiles: ["grass", "dirt"] },
};

describe("parseAssetManifest", () => {
  it("accepts a valid manifest", () => {
    const manifest = parseAssetManifest({
      version: 1,
      assets: { "tileset.village": validEntry },
    });
    expect(manifest.version).toBe(1);
    expect(manifest.assets["tileset.village"].path).toBe("tilesets/village.png");
  });

  it("rejects a non-object root", () => {
    expect(() => parseAssetManifest([1, 2, 3])).toThrow(/root must be an object/);
  });

  it("rejects a missing path", () => {
    expect(() =>
      parseAssetManifest({ version: 1, assets: { "x.k": { placeholder: { kind: "icon" } } } }),
    ).toThrow(/non-empty string "path"/);
  });

  it("rejects an unknown placeholder kind", () => {
    expect(() =>
      parseAssetManifest({
        version: 1,
        assets: { "x.k": { path: "a.png", placeholder: { kind: "banner" } } },
      }),
    ).toThrow(/unknown placeholder kind/);
  });

  it("rejects malformed tiles arrays instead of silently degrading", () => {
    expect(() =>
      parseAssetManifest({
        version: 1,
        assets: {
          "x.k": { path: "a.png", placeholder: { kind: "tileset", tiles: ["grass", 7] } },
        },
      }),
    ).toThrow(/"tiles" as a string array/);
  });

  it("rejects a non-positive-integer version", () => {
    expect(() => parseAssetManifest({ version: 0, assets: {} })).toThrow(/positive integer/);
    expect(() => parseAssetManifest({ version: 1.5, assets: {} })).toThrow(/positive integer/);
  });
});
