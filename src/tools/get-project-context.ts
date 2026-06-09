import { groupBySession, getProjectInfos } from "../parsers/history-parser.js";
import { parseTranscriptHistory } from "../parsers/transcript-history.js";
import { extractProjectName } from "../utils/path-encoder.js";
import type { SearchEngine } from "../search/search-engine.js";

export const getProjectContextTool = {
  name: "get_project_context",
  description:
    "Get comprehensive context for a project: recent sessions, key topics, common tools, and patterns. Useful for session-start context injection.",
  inputSchema: {
    type: "object" as const,
    properties: {
      project: {
        type: "string",
        description:
          "Project name or path. Defaults to current working directory.",
      },
      depth: {
        type: "string",
        enum: ["brief", "normal", "detailed"],
        description:
          "Detail level: brief (last session only), normal (last 3), detailed (last 5 + patterns). Default: normal.",
      },
    },
  },
};

export function handleGetProjectContext(
  engine: SearchEngine,
  args: { project?: string; depth?: string }
): string {
  const project = args.project || "";
  const depth = args.depth || "normal";

  if (!project) {
    return "Please provide a project name or path.";
  }

  const entries = parseTranscriptHistory();
  const query = project.toLowerCase();

  const matching = entries.filter(
    (e) =>
      e.project.toLowerCase().includes(query) ||
      extractProjectName(e.project).toLowerCase().includes(query)
  );

  if (matching.length === 0) {
    return `No history found for project "${project}".`;
  }

  const projectName = extractProjectName(matching[0].project);
  const bySession = groupBySession(matching);

  // Sort sessions by most recent activity
  const sessionList = [...bySession.entries()]
    .map(([sessionId, entries]) => ({
      sessionId,
      entries,
      lastActivity: Math.max(...entries.map((e) => e.timestamp)),
      firstActivity: Math.min(...entries.map((e) => e.timestamp)),
    }))
    .sort((a, b) => b.lastActivity - a.lastActivity);

  const sessionCount = depth === "brief" ? 1 : depth === "detailed" ? 5 : 3;

  const lines: string[] = [
    `## Project Context: ${projectName}`,
    "",
    `**Total sessions**: ${sessionList.length}`,
    `**Total messages**: ${matching.length}`,
    "",
    `### Recent Sessions`,
  ];

  for (const session of sessionList.slice(0, sessionCount)) {
    const date = new Date(session.lastActivity).toLocaleDateString();
    const daysAgo = Math.floor(
      (Date.now() - session.lastActivity) / 86400000
    );
    const daysStr =
      daysAgo === 0
        ? "today"
        : daysAgo === 1
          ? "yesterday"
          : `${daysAgo} days ago`;

    // First user message as topic
    const firstMsg = session.entries[0]?.display || "Unknown topic";
    const topic =
      firstMsg.length > 120 ? firstMsg.slice(0, 120) + "..." : firstMsg;

    lines.push(`- **${date}** (${daysStr}): ${topic}`);
    lines.push(`  Session: ${session.sessionId} — ${session.entries.length} messages`);
  }

  // If detailed, also search for patterns
  if (depth === "detailed") {
    lines.push("");
    lines.push("### Common Topics");

    // Simple frequency analysis of user messages
    const allDisplays = matching.map((e) => e.display.toLowerCase());
    const wordFreq = new Map<string, number>();
    for (const display of allDisplays) {
      const words = display.split(/\s+/).filter((w) => w.length > 4);
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    const topWords = [...wordFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [word, count] of topWords) {
      lines.push(`- "${word}" (${count} mentions)`);
    }
  }

  return lines.join("\n");
}
