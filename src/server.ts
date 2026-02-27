/**
 * MCP server: tool registration and request handling using McpServer API.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { IndexManager } from "./indexing/index-manager.js";
import { SearchEngine } from "./search/search-engine.js";
import { handleSearchHistory } from "./tools/search-history.js";
import { handleListProjects } from "./tools/list-projects.js";
import { handleFindSolutions } from "./tools/find-solutions.js";
import { handleGetSessionSummary } from "./tools/get-session-summary.js";
import { handleGetProjectContext } from "./tools/get-project-context.js";
import { handleFindPatterns } from "./tools/find-patterns.js";
import {
  isCloudConfigured,
  checkConnection,
  pushKnowledge,
  pushSessions,
  pullKnowledge,
  pullSessions,
  fromCloudKnowledge,
} from "./sync/cloud-client.js";
import { loadSyncState, updateSyncState } from "./sync/sync-state.js";
import { KnowledgeStore } from "./knowledge/knowledge-store.js";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { CONFIG } from "./config.js";
import type { SessionSummary } from "./knowledge/session-summarizer.js";

export function createServer(): {
  server: McpServer;
  init: () => Promise<void>;
} {
  const server = new McpServer(
    { name: "claude-history-mcp", version: "0.1.0" },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const indexManager = new IndexManager();
  const searchEngine = new SearchEngine(indexManager);
  let initialized = false;

  async function ensureIndex(): Promise<void> {
    if (initialized) return;

    const loaded = await indexManager.load();
    if (loaded) {
      indexManager.incrementalUpdate().catch(() => {});
    } else {
      await indexManager.buildFullIndex();
      await indexManager.save().catch(() => {});
    }
    initialized = true;
  }

  // Register tools
  server.tool(
    "search_history",
    "Search past Claude Code conversations. Supports filter syntax: project:name, before:date, after:date, tool:name. Dates can be relative (7d, 30d, 1w) or ISO (2024-01-15).",
    {
      query: z.string().describe("Search query. Can include filters like project:myapp before:7d"),
      project: z.string().optional().describe("Filter to a specific project name or path"),
      limit: z.number().optional().describe("Maximum results (default: 20, max: 100)"),
      include_context: z.boolean().optional().describe("Include surrounding message context (default: false)"),
    },
    async (args) => {
      await ensureIndex();
      const result = handleSearchHistory(searchEngine, args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "list_projects",
    "List all projects that have Claude Code conversation history, with session counts and activity dates.",
    {
      sort_by: z.enum(["recent", "sessions", "messages", "name"]).optional().describe("Sort order (default: recent)"),
    },
    async (args) => {
      const result = handleListProjects(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "find_solutions",
    "Search past conversations for solutions to errors or problems. Prioritizes results containing fix/resolution language.",
    {
      error_or_problem: z.string().describe("The error message, problem description, or issue to find solutions for"),
      technology: z.string().optional().describe("Optional technology context (e.g., 'docker', 'typescript', 'react')"),
    },
    async (args) => {
      await ensureIndex();
      const result = handleFindSolutions(searchEngine, args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_session_summary",
    "Get a structured summary of a conversation session. Provide either a session ID or project name (returns most recent session).",
    {
      session_id: z.string().optional().describe("Specific session UUID"),
      project: z.string().optional().describe("Project name or path. Returns summary of most recent session."),
    },
    async (args) => {
      const result = handleGetSessionSummary(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "get_project_context",
    "Get comprehensive context for a project: recent sessions, key topics, common tools, and patterns. Useful for session-start context injection.",
    {
      project: z.string().optional().describe("Project name or path. Defaults to current working directory."),
      depth: z.enum(["brief", "normal", "detailed"]).optional().describe("Detail level (default: normal)"),
    },
    async (args) => {
      await ensureIndex();
      const result = handleGetProjectContext(searchEngine, args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  server.tool(
    "find_patterns",
    "Discover recurring patterns in conversation history: common topics, frequent workflows, repeated issues.",
    {
      project: z.string().optional().describe("Limit to a specific project"),
      type: z.enum(["topics", "workflows", "issues", "all"]).optional().describe("Type of patterns to find (default: all)"),
    },
    async (args) => {
      const result = handleFindPatterns(args);
      return { content: [{ type: "text", text: result }] };
    }
  );

  // --- Cloud sync tools ---

  server.tool(
    "cloud_sync_status",
    "Check cloud sync configuration and connection status. Shows whether sync is configured, last sync times, and connection health.",
    {},
    async () => {
      if (!isCloudConfigured()) {
        return {
          content: [{
            type: "text",
            text: "Cloud sync is not configured.\n\nTo enable, set these environment variables:\n- CLAUDE_HISTORY_API_URL: Your cloud server URL (e.g. https://your-server.com)\n- CLAUDE_HISTORY_API_KEY: Your API key (generate via /api/auth/api-key)\n- CLAUDE_HISTORY_TEAM_ID: (optional) Team ID for shared sync",
          }],
        };
      }

      const conn = await checkConnection();
      const state = loadSyncState();

      const lines = [
        `Cloud sync: ${conn.ok ? "Connected" : "Disconnected"}`,
        `Server: ${CONFIG.cloud.apiUrl}`,
        conn.ok ? `User: ${conn.user}` : `Error: ${conn.error}`,
        CONFIG.cloud.teamId ? `Team: ${CONFIG.cloud.teamId}` : "Team: none (personal sync)",
        "",
        "Last sync:",
        `  Push knowledge: ${state.lastPushKnowledge ? new Date(state.lastPushKnowledge).toISOString() : "never"}`,
        `  Push sessions:  ${state.lastPushSessions ? new Date(state.lastPushSessions).toISOString() : "never"}`,
        `  Pull knowledge: ${state.lastPullKnowledge ? new Date(state.lastPullKnowledge).toISOString() : "never"}`,
        `  Pull sessions:  ${state.lastPullSessions ? new Date(state.lastPullSessions).toISOString() : "never"}`,
        `  Total pushes: ${state.pushCount}`,
        `  Total pulls: ${state.pullCount}`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "cloud_sync_push",
    "Push local knowledge entries and session summaries to the cloud server. Only pushes entries newer than the last sync.",
    {
      force: z.boolean().optional().describe("Push all entries regardless of last sync time (default: false)"),
    },
    async (args) => {
      if (!isCloudConfigured()) {
        return {
          content: [{ type: "text", text: "Cloud sync not configured. Run cloud_sync_status for setup instructions." }],
        };
      }

      const state = loadSyncState();
      const since = args.force ? 0 : undefined;

      // Push knowledge entries
      const store = new KnowledgeStore();
      store.load();
      const allEntries = store.getAllEntries();
      const knowledgeToSync = since === 0
        ? [...allEntries]
        : allEntries.filter((e) => e.timestamp > state.lastPushKnowledge);

      const knowledgeResult = await pushKnowledge(knowledgeToSync);

      // Push session summaries from cache
      const summaries: SessionSummary[] = [];
      try {
        const files = readdirSync(CONFIG.summariesDir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = readFileSync(join(CONFIG.summariesDir, file), "utf-8");
            const summary = JSON.parse(raw) as SessionSummary;
            if (since === 0 || summary.endTime > state.lastPushSessions) {
              summaries.push(summary);
            }
          } catch { /* skip corrupt files */ }
        }
      } catch { /* no summaries dir yet */ }

      const sessionsResult = await pushSessions(summaries);

      const now = Date.now();
      updateSyncState({
        lastPushKnowledge: now,
        lastPushSessions: now,
        pushCount: state.pushCount + 1,
      });

      const lines = [
        "Push complete:",
        `  Knowledge: ${knowledgeResult.accepted} new, ${knowledgeResult.skipped} already synced (${knowledgeToSync.length} total)`,
        `  Sessions: ${sessionsResult.accepted} new, ${sessionsResult.updated} updated (${summaries.length} total)`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.tool(
    "cloud_sync_pull",
    "Pull knowledge entries and session summaries from the cloud server. Merges with local data without duplicates.",
    {
      force: z.boolean().optional().describe("Pull all entries regardless of last sync time (default: false)"),
    },
    async (args) => {
      if (!isCloudConfigured()) {
        return {
          content: [{ type: "text", text: "Cloud sync not configured. Run cloud_sync_status for setup instructions." }],
        };
      }

      const state = loadSyncState();
      const since = args.force ? undefined : (state.lastPullKnowledge || undefined);

      // Pull knowledge
      const knowledgeResult = await pullKnowledge(since);
      let knowledgeMerged = 0;

      if (knowledgeResult.entries.length > 0) {
        const store = new KnowledgeStore();
        store.load();
        for (const entry of knowledgeResult.entries) {
          const local = fromCloudKnowledge(entry);
          if (!store.hasEntry(local.id)) {
            store.addEntry(local);
            knowledgeMerged++;
          }
        }
        store.save();
      }

      // Pull sessions
      const sessionsSince = args.force ? undefined : (state.lastPullSessions || undefined);
      const sessionsResult = await pullSessions(sessionsSince);

      const now = Date.now();
      updateSyncState({
        lastPullKnowledge: now,
        lastPullSessions: now,
        pullCount: state.pullCount + 1,
      });

      const lines = [
        "Pull complete:",
        `  Knowledge: ${knowledgeMerged} new entries merged (${knowledgeResult.entries.length} received from cloud)`,
        `  Sessions: ${sessionsResult.summaries.length} received from cloud`,
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  return {
    server,
    init: ensureIndex,
  };
}
