import { getProjectInfos } from "../parsers/history-parser.js";
import { parseTranscriptHistory } from "../parsers/transcript-history.js";
import { extractProjectName } from "../utils/path-encoder.js";

export const listProjectsTool = {
  name: "list_projects",
  description:
    "List all projects that have Claude Code conversation history, with session counts and activity dates.",
  inputSchema: {
    type: "object" as const,
    properties: {
      sort_by: {
        type: "string",
        enum: ["recent", "sessions", "messages", "name"],
        description: "Sort order (default: recent)",
      },
    },
  },
};

export function handleListProjects(args: { sort_by?: string }): string {
  const entries = parseTranscriptHistory();
  const infos = getProjectInfos(entries);

  if (infos.length === 0) {
    return "No projects with conversation history found.";
  }

  // Sort
  const sortBy = args.sort_by || "recent";
  switch (sortBy) {
    case "sessions":
      infos.sort((a, b) => b.sessionCount - a.sessionCount);
      break;
    case "messages":
      infos.sort((a, b) => b.messageCount - a.messageCount);
      break;
    case "name":
      infos.sort((a, b) => a.path.localeCompare(b.path));
      break;
    case "recent":
    default:
      infos.sort((a, b) => b.lastActivity - a.lastActivity);
      break;
  }

  const lines: string[] = [`${infos.length} projects with conversation history:\n`];

  for (const info of infos) {
    const name = extractProjectName(info.path);
    const lastDate = info.lastActivity
      ? new Date(info.lastActivity).toLocaleDateString()
      : "unknown";
    const firstDate = info.firstActivity
      ? new Date(info.firstActivity).toLocaleDateString()
      : "unknown";

    lines.push(
      `- **${name}** — ${info.sessionCount} sessions, ${info.messageCount} messages`
    );
    lines.push(`  Path: ${info.path}`);
    lines.push(`  Active: ${firstDate} → ${lastDate}`);
  }

  return lines.join("\n");
}
