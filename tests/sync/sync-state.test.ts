import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, unlinkSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock CONFIG before importing
const testDir = join(tmpdir(), `claude-history-test-${Date.now()}`);
mkdirSync(testDir, { recursive: true });

vi.mock("../../src/config.js", () => ({
  CONFIG: {
    dataDir: testDir,
    syncStateFile: join(testDir, "sync-state.json"),
  },
}));

// Import after mock
const { loadSyncState, saveSyncState, updateSyncState } = await import(
  "../../src/sync/sync-state.js"
);

describe("sync-state", () => {
  const stateFile = join(testDir, "sync-state.json");

  beforeEach(() => {
    // Clear cached state by re-importing would be complex, so just reset file
    if (existsSync(stateFile)) unlinkSync(stateFile);
  });

  afterEach(() => {
    if (existsSync(stateFile)) unlinkSync(stateFile);
  });

  it("returns default state when no file exists", () => {
    const state = loadSyncState();
    expect(state.lastPushKnowledge).toBe(0);
    expect(state.lastPullKnowledge).toBe(0);
    expect(state.pushCount).toBe(0);
    expect(state.pullCount).toBe(0);
  });

  it("saves and loads state", () => {
    const state = {
      lastPushKnowledge: 1000,
      lastPushSessions: 2000,
      lastPullKnowledge: 3000,
      lastPullSessions: 4000,
      pushCount: 5,
      pullCount: 3,
    };
    saveSyncState(state);

    expect(existsSync(stateFile)).toBe(true);
    const raw = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(raw.pushCount).toBe(5);
  });

  it("updates partial state", () => {
    saveSyncState({
      lastPushKnowledge: 100,
      lastPushSessions: 0,
      lastPullKnowledge: 0,
      lastPullSessions: 0,
      pushCount: 1,
      pullCount: 0,
    });

    const updated = updateSyncState({ pushCount: 2, lastPushKnowledge: 200 });
    expect(updated.pushCount).toBe(2);
    expect(updated.lastPushKnowledge).toBe(200);
    expect(updated.pullCount).toBe(0); // unchanged
  });
});
