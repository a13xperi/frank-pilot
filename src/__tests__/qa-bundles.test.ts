/**
 * Unit tests for the qa-bundle grouping logic.
 *
 * Network is not touched — only the pure helpers exported by routes.ts.
 */

import {
  parseStem,
  splitName,
  groupBundles,
  QA_BUCKET,
  type StorageObject,
} from "../modules/qa/routes";

const BASE = `https://example.supabase.co/storage/v1/object/public/${QA_BUCKET}`;

describe("parseStem", () => {
  it("parses a single-token slug", () => {
    expect(parseStem("frank-home-20260522-143000")).toEqual({
      slug: "home",
      capturedAt: "2026-05-22T14:30:00",
    });
  });

  it("parses a hyphenated slug", () => {
    expect(parseStem("frank-dashboard-overview-20260522-143000")).toEqual({
      slug: "dashboard-overview",
      capturedAt: "2026-05-22T14:30:00",
    });
  });

  it("rejects stems without the timestamp suffix", () => {
    expect(parseStem("frank-home")).toBeNull();
    expect(parseStem("frank-home-2026-05-22")).toBeNull();
  });

  it("rejects stems that don't start with frank-", () => {
    // The regex anchors on `^frank-` — a foreign prefix means it's not ours.
    expect(parseStem("not-a-frank-stem-20260522-143000")).toBeNull();
  });
});

describe("splitName", () => {
  it("classifies .replay.json before .json", () => {
    expect(splitName("frank-home-20260522-143000.replay.json")).toEqual({
      stem: "frank-home-20260522-143000",
      kind: "replay",
    });
  });

  it("classifies .json", () => {
    expect(splitName("frank-home-20260522-143000.json")).toEqual({
      stem: "frank-home-20260522-143000",
      kind: "json",
    });
  });

  it("classifies .png", () => {
    expect(splitName("frank-home-20260522-143000.png")).toEqual({
      stem: "frank-home-20260522-143000",
      kind: "png",
    });
  });

  it("returns null for unrelated names", () => {
    expect(splitName("README.md")).toBeNull();
    expect(splitName(".keep")).toBeNull();
    expect(splitName("frank-home-20260522-143000.txt")).toBeNull();
  });
});

describe("groupBundles", () => {
  function items(...names: string[]): StorageObject[] {
    return names.map((name) => ({ name }));
  }

  it("groups three artifacts that share a stem", () => {
    const out = groupBundles(
      items(
        "frank-home-20260522-143000.png",
        "frank-home-20260522-143000.json",
        "frank-home-20260522-143000.replay.json"
      ),
      BASE
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      stem: "frank-home-20260522-143000",
      slug: "home",
      capturedAt: "2026-05-22T14:30:00",
      urls: {
        png: `${BASE}/frank-home-20260522-143000.png`,
        json: `${BASE}/frank-home-20260522-143000.json`,
        replay: `${BASE}/frank-home-20260522-143000.replay.json`,
      },
    });
  });

  it("handles a bundle with no replay (png + json only)", () => {
    const out = groupBundles(
      items(
        "frank-home-20260522-143000.png",
        "frank-home-20260522-143000.json"
      ),
      BASE
    );
    expect(out).toHaveLength(1);
    expect(out[0].urls.replay).toBeNull();
    expect(out[0].urls.png).not.toBeNull();
  });

  it("drops bundles missing the JSON sidecar", () => {
    // Capture failed before the sidecar upload — useless to operators.
    const out = groupBundles(
      items(
        "frank-home-20260522-143000.png",
        "frank-home-20260522-143000.replay.json"
      ),
      BASE
    );
    expect(out).toHaveLength(0);
  });

  it("drops bundles with a malformed stem", () => {
    const out = groupBundles(
      items("not-our-format.json", "frank-stem-without-timestamp.json"),
      BASE
    );
    expect(out).toHaveLength(0);
  });

  it("ignores irrelevant files (e.g. .gitkeep)", () => {
    const out = groupBundles(
      items(
        ".gitkeep",
        "README.md",
        "frank-home-20260522-143000.json",
        "frank-home-20260522-143000.png"
      ),
      BASE
    );
    expect(out).toHaveLength(1);
  });

  it("sorts most-recent first", () => {
    const out = groupBundles(
      items(
        "frank-a-20260522-120000.json",
        "frank-a-20260522-120000.png",
        "frank-b-20260522-130000.json",
        "frank-b-20260522-130000.png",
        "frank-c-20260521-235959.json",
        "frank-c-20260521-235959.png"
      ),
      BASE
    );
    expect(out.map((b) => b.slug)).toEqual(["b", "a", "c"]);
  });

  it("composes URLs against the provided base", () => {
    const out = groupBundles(
      items(
        "frank-home-20260522-143000.png",
        "frank-home-20260522-143000.json"
      ),
      "https://other.example/bucket/path"
    );
    expect(out[0].urls.png).toBe(
      "https://other.example/bucket/path/frank-home-20260522-143000.png"
    );
    expect(out[0].urls.json).toBe(
      "https://other.example/bucket/path/frank-home-20260522-143000.json"
    );
  });
});
