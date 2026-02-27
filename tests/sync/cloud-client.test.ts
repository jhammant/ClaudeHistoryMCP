import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock CONFIG
vi.mock("../../src/config.js", () => ({
  CONFIG: {
    cloud: {
      apiUrl: "",
      apiKey: "",
      teamId: "",
    },
    dataDir: "/tmp/test-cloud-client",
    syncStateFile: "/tmp/test-cloud-client/sync-state.json",
  },
}));

const { CONFIG } = await import("../../src/config.js");
const {
  isCloudConfigured,
  pushKnowledge,
  pushSessions,
  pullKnowledge,
  pullSessions,
  checkConnection,
  fromCloudKnowledge,
} = await import("../../src/sync/cloud-client.js");

describe("cloud-client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (CONFIG.cloud as any).apiUrl = "";
    (CONFIG.cloud as any).apiKey = "";
    (CONFIG.cloud as any).teamId = "";
  });

  describe("isCloudConfigured", () => {
    it("returns false when not configured", () => {
      expect(isCloudConfigured()).toBe(false);
    });

    it("returns true when URL and key are set", () => {
      (CONFIG.cloud as any).apiUrl = "https://example.com";
      (CONFIG.cloud as any).apiKey = "test-key";
      expect(isCloudConfigured()).toBe(true);
    });

    it("returns false with only URL", () => {
      (CONFIG.cloud as any).apiUrl = "https://example.com";
      expect(isCloudConfigured()).toBe(false);
    });
  });

  describe("unconfigured operations return errors", () => {
    it("pushKnowledge returns error", async () => {
      const result = await pushKnowledge([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("pushSessions returns error", async () => {
      const result = await pushSessions([]);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("pullKnowledge returns error", async () => {
      const result = await pullKnowledge();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("pullSessions returns error", async () => {
      const result = await pullSessions();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not configured");
    });

    it("checkConnection returns error", async () => {
      const result = await checkConnection();
      expect(result.ok).toBe(false);
      expect(result.error).toContain("not configured");
    });
  });

  describe("empty push succeeds", () => {
    it("pushKnowledge with empty array succeeds", async () => {
      (CONFIG.cloud as any).apiUrl = "https://example.com";
      (CONFIG.cloud as any).apiKey = "test-key";
      const result = await pushKnowledge([]);
      expect(result.success).toBe(true);
      expect(result.accepted).toBe(0);
    });

    it("pushSessions with empty array succeeds", async () => {
      (CONFIG.cloud as any).apiUrl = "https://example.com";
      (CONFIG.cloud as any).apiKey = "test-key";
      const result = await pushSessions([]);
      expect(result.success).toBe(true);
      expect(result.accepted).toBe(0);
    });
  });

  describe("fromCloudKnowledge", () => {
    it("converts cloud format to local format", () => {
      const cloud = {
        id: "abc-123",
        type: "solution",
        project: "my-project",
        session_id: "sess-456",
        timestamp: 1700000000000,
        summary: "Fixed the bug",
        details: "Used a different approach",
        tags: ["typescript", "debug"],
        related_files: ["/src/index.ts"],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const local = fromCloudKnowledge(cloud);
      expect(local.id).toBe("abc-123");
      expect(local.type).toBe("solution");
      expect(local.project).toBe("my-project");
      expect(local.sessionId).toBe("sess-456");
      expect(local.timestamp).toBe(1700000000000);
      expect(local.summary).toBe("Fixed the bug");
      expect(local.details).toBe("Used a different approach");
      expect(local.tags).toEqual(["typescript", "debug"]);
      expect(local.relatedFiles).toEqual(["/src/index.ts"]);
    });

    it("handles null fields", () => {
      const cloud = {
        id: "abc-123",
        type: "decision",
        project: null,
        session_id: null,
        timestamp: 1700000000000,
        summary: "Decided X",
        details: null,
        tags: [],
        related_files: [],
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
      };

      const local = fromCloudKnowledge(cloud);
      expect(local.project).toBe("");
      expect(local.sessionId).toBe("");
      expect(local.details).toBe("");
    });
  });
});
