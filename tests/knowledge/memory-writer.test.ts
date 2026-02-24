import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writeLearningsToMemory, filterLearningsForProject } from "../../src/knowledge/memory-writer.js";
import type { KnowledgeEntry } from "../../src/knowledge/knowledge-store.js";

// Override CONFIG for tests
import { CONFIG } from "../../src/config.js";

function makeLearning(
  overrides: Partial<KnowledgeEntry> = {}
): KnowledgeEntry {
  return {
    id: Math.random().toString(36).slice(2),
    type: "learning",
    project: "test-project",
    sessionId: "_synthesized",
    timestamp: Date.now(),
    summary: "Pin Docker image versions to avoid build failures",
    details: "Synthesized from 3 entries",
    tags: ["docker"],
    relatedFiles: [],
    occurrences: 3,
    projectCount: 2,
    ...overrides,
  };
}

describe("writeLearningsToMemory", () => {
  let testDir: string;
  let originalClaudeDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `claude-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    originalClaudeDir = (CONFIG as { claudeDir: string }).claudeDir;
    (CONFIG as { claudeDir: string }).claudeDir = testDir;
  });

  afterEach(() => {
    (CONFIG as { claudeDir: string }).claudeDir = originalClaudeDir;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should create MEMORY.md with managed section", () => {
    const learnings = [makeLearning()];
    writeLearningsToMemory("test-project", learnings);

    const memoryFile = join(testDir, "projects", "test-project", "memory", "MEMORY.md");
    expect(existsSync(memoryFile)).toBe(true);

    const content = readFileSync(memoryFile, "utf-8");
    expect(content).toContain("<!-- BEGIN CLAUDE_HISTORY_LEARNINGS -->");
    expect(content).toContain("<!-- END CLAUDE_HISTORY_LEARNINGS -->");
    expect(content).toContain("Pin Docker image versions");
    expect(content).toContain("## Learnings (auto-managed by ClaudeHistoryMCP)");
  });

  it("should preserve user content when updating managed section", () => {
    const memoryDir = join(testDir, "projects", "test-project", "memory");
    mkdirSync(memoryDir, { recursive: true });
    const memoryFile = join(memoryDir, "MEMORY.md");

    // Write user content first
    writeFileSync(
      memoryFile,
      "# My Notes\n\nThis is my custom content.\n\n## Learnings (auto-managed by ClaudeHistoryMCP)\n<!-- BEGIN CLAUDE_HISTORY_LEARNINGS -->\n- Old learning\n<!-- END CLAUDE_HISTORY_LEARNINGS -->\n"
    );

    // Update with new learnings
    const learnings = [
      makeLearning({ summary: "New learning about Docker" }),
    ];
    writeLearningsToMemory("test-project", learnings);

    const content = readFileSync(memoryFile, "utf-8");
    expect(content).toContain("# My Notes");
    expect(content).toContain("This is my custom content.");
    expect(content).toContain("New learning about Docker");
    expect(content).not.toContain("Old learning");
  });

  it("should not write if no learnings provided", () => {
    writeLearningsToMemory("test-project", []);

    const memoryFile = join(testDir, "projects", "test-project", "memory", "MEMORY.md");
    expect(existsSync(memoryFile)).toBe(false);
  });

  it("should limit learnings to maxLearningsPerProject", () => {
    const learnings = Array.from({ length: 15 }, (_, i) =>
      makeLearning({ summary: `Learning number ${i}` })
    );
    writeLearningsToMemory("test-project", learnings);

    const memoryFile = join(testDir, "projects", "test-project", "memory", "MEMORY.md");
    const content = readFileSync(memoryFile, "utf-8");

    // Should contain max 10 learnings (CONFIG.learning.maxLearningsPerProject)
    const learningLines = content
      .split("\n")
      .filter((l) => l.startsWith("- Learning number"));
    expect(learningLines.length).toBe(10);
  });

  it("should handle content after the managed section", () => {
    const memoryDir = join(testDir, "projects", "test-project", "memory");
    mkdirSync(memoryDir, { recursive: true });
    const memoryFile = join(memoryDir, "MEMORY.md");

    writeFileSync(
      memoryFile,
      "# Before\n\n## Learnings (auto-managed by ClaudeHistoryMCP)\n<!-- BEGIN CLAUDE_HISTORY_LEARNINGS -->\n- Old\n<!-- END CLAUDE_HISTORY_LEARNINGS -->\n\n## After\n\nMore content here.\n"
    );

    writeLearningsToMemory("test-project", [
      makeLearning({ summary: "Updated learning" }),
    ]);

    const content = readFileSync(memoryFile, "utf-8");
    expect(content).toContain("# Before");
    expect(content).toContain("Updated learning");
    expect(content).toContain("## After");
    expect(content).toContain("More content here.");
    expect(content).not.toContain("Old");
  });
});

describe("filterLearningsForProject", () => {
  it("should filter by matching tags", () => {
    const learnings = [
      makeLearning({ tags: ["docker"], occurrences: 3 }),
      makeLearning({ tags: ["python"], occurrences: 3 }),
    ];
    const filtered = filterLearningsForProject(learnings, ["docker"]);
    expect(filtered.length).toBe(1);
    expect(filtered[0].tags).toContain("docker");
  });

  it("should always include high-occurrence learnings", () => {
    const learnings = [
      makeLearning({ tags: ["python"], occurrences: 5 }),
      makeLearning({ tags: ["python"], occurrences: 2 }),
    ];
    const filtered = filterLearningsForProject(learnings, ["docker"]);
    expect(filtered.length).toBe(1);
    expect(filtered[0].occurrences).toBe(5);
  });

  it("should return all if no project tags", () => {
    const learnings = [
      makeLearning({ tags: ["docker"] }),
      makeLearning({ tags: ["python"] }),
    ];
    const filtered = filterLearningsForProject(learnings, []);
    expect(filtered.length).toBe(2);
  });
});
