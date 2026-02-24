import { describe, it, expect } from "vitest";
import {
  clusterEntries,
  scoreCluster,
  jaccardSimilarity,
  stemmedWords,
} from "../../src/knowledge/learning-synthesizer.js";
import type { KnowledgeEntry } from "../../src/knowledge/knowledge-store.js";

function makeEntry(
  overrides: Partial<KnowledgeEntry> = {}
): KnowledgeEntry {
  return {
    id: Math.random().toString(36).slice(2),
    type: "solution",
    project: "test-project",
    sessionId: "session-1",
    timestamp: Date.now(),
    summary: "Fixed the docker build issue",
    details: "",
    tags: ["docker"],
    relatedFiles: [],
    ...overrides,
  };
}

describe("jaccardSimilarity", () => {
  it("should return 1 for identical sets", () => {
    const a = new Set(["foo", "bar", "baz"]);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it("should return 0 for disjoint sets", () => {
    const a = new Set(["foo", "bar"]);
    const b = new Set(["baz", "qux"]);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it("should return correct value for partial overlap", () => {
    const a = new Set(["foo", "bar", "baz"]);
    const b = new Set(["bar", "baz", "qux"]);
    // intersection = 2, union = 4
    expect(jaccardSimilarity(a, b)).toBe(0.5);
  });

  it("should return 1 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });
});

describe("stemmedWords", () => {
  it("should stem and lowercase words", () => {
    const result = stemmedWords("Running Docker containers");
    expect(result.has("run")).toBe(true);
    expect(result.has("docker")).toBe(true);
    expect(result.has("contain")).toBe(true);
  });

  it("should filter short words", () => {
    const result = stemmedWords("a is the docker");
    // "a", "is" are <= 2 chars, "the" is 3 chars
    expect(result.has("a")).toBe(false);
    expect(result.has("is")).toBe(false);
    expect(result.has("docker")).toBe(true);
  });

  it("should strip punctuation", () => {
    const result = stemmedWords("docker-compose, running!");
    expect(result.has("docker")).toBe(true);
    expect(result.has("compos")).toBe(true);
  });
});

describe("clusterEntries", () => {
  it("should group identical summaries into one cluster", () => {
    const entries = [
      makeEntry({ summary: "Fixed the docker build issue", tags: ["docker"], sessionId: "s1" }),
      makeEntry({ summary: "Fixed the docker build issue", tags: ["docker"], sessionId: "s2" }),
      makeEntry({ summary: "Fixed the docker build issue", tags: ["docker"], sessionId: "s3" }),
    ];
    const clusters = clusterEntries(entries);
    expect(clusters.length).toBe(1);
    expect(clusters[0].entries.length).toBe(3);
  });

  it("should separate entries with no shared tags", () => {
    const entries = [
      makeEntry({ summary: "Docker build failed", tags: ["docker"] }),
      makeEntry({ summary: "Python import error", tags: ["python"] }),
    ];
    const clusters = clusterEntries(entries);
    expect(clusters.length).toBe(2);
  });

  it("should cluster similar summaries with shared tags", () => {
    const entries = [
      makeEntry({ summary: "Fixed docker build cache issue", tags: ["docker"] }),
      makeEntry({ summary: "Fixed docker build cache problem", tags: ["docker"] }),
    ];
    const clusters = clusterEntries(entries);
    expect(clusters.length).toBe(1);
    expect(clusters[0].entries.length).toBe(2);
  });

  it("should keep dissimilar entries in separate clusters despite shared tags", () => {
    const entries = [
      makeEntry({
        summary: "Docker container networking port conflict resolution",
        tags: ["docker"],
      }),
      makeEntry({
        summary: "Python virtual environment pip install broken",
        tags: ["docker", "python"],
      }),
    ];
    const clusters = clusterEntries(entries);
    expect(clusters.length).toBe(2);
  });
});

describe("scoreCluster", () => {
  it("should score a single entry low", () => {
    const cluster = {
      key: "test",
      entries: [makeEntry()],
      tags: new Set(["docker"]),
      sessions: new Set(["s1"]),
      projects: new Set(["p1"]),
    };
    const score = scoreCluster(cluster);
    // 1*2 + 1*3 + 1*5 = 10 (borderline)
    expect(score).toBe(10);
  });

  it("should score high for cross-project, multi-session cluster", () => {
    const cluster = {
      key: "test",
      entries: [
        makeEntry({ type: "error_fix" }),
        makeEntry({ type: "error_fix" }),
        makeEntry({ type: "solution" }),
        makeEntry({ type: "solution" }),
      ],
      tags: new Set(["docker"]),
      sessions: new Set(["s1", "s2", "s3"]),
      projects: new Set(["p1", "p2"]),
    };
    const score = scoreCluster(cluster);
    // freq: 4*2=8, sessions: 3*3=9, projects: 2*5=10, error_fix bonus: 5
    expect(score).toBe(32);
  });

  it("should cap frequency score at 20", () => {
    const entries = Array.from({ length: 15 }, () => makeEntry());
    const cluster = {
      key: "test",
      entries,
      tags: new Set(["docker"]),
      sessions: new Set(["s1"]),
      projects: new Set(["p1"]),
    };
    const score = scoreCluster(cluster);
    // freq: 10*2=20 (capped), sessions: 1*3=3, projects: 1*5=5
    expect(score).toBe(28);
  });

  it("should not give error_fix bonus for fewer than 2 error_fixes", () => {
    const cluster = {
      key: "test",
      entries: [
        makeEntry({ type: "error_fix" }),
        makeEntry({ type: "solution" }),
      ],
      tags: new Set(["docker"]),
      sessions: new Set(["s1", "s2"]),
      projects: new Set(["p1"]),
    };
    const score = scoreCluster(cluster);
    // freq: 2*2=4, sessions: 2*3=6, projects: 1*5=5, no bonus
    expect(score).toBe(15);
  });
});
