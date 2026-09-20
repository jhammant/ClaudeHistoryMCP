import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { CONFIG } from "../config.js";
import {
  parseSessionFile,
  type ParsedSession,
} from "../parsers/session-parser.js";
import {
  groupBySession,
} from "../parsers/history-parser.js";
import { parseTranscriptHistory } from "../parsers/transcript-history.js";
import { extractProjectName } from "../utils/path-encoder.js";

export const getSessionSummaryTool = {
  name: "get_session_summary",
  description:
    "Get a structured summary of a conversation session. Provide either a session ID or project name (returns most recent session for the project).",
  inputSchema: {
    type: "object" as const,
    properties: {
      session_id: {
        type: "string",
        description: "Specific session UUID",
      },
      project: {
        type: "string",
        description:
          "Project name or path. Returns summary of most recent session.",
      },
    },
  },
};

export function handleGetSessionSummary(args: {
  session_id?: string;
  project?: string;
}): string {
  if (!args.session_id && !args.project) {
    return "Please provide either session_id or project.";
  }

  let session: ParsedSession | null = null;

  if (args.session_id) {
    session = findSessionById(args.session_id);
  } else if (args.project) {
    session = findLatestSessionForProject(args.project);
  }

  if (!session) {
    return args.session_id
      ? `Session ${args.session_id} not found.`
      : `No sessions found for project "${args.project}".`;
  }

  return formatSessionSummary(session);
}

function findSessionById(sessionId: string): ParsedSession | null {
  const projectsDir = CONFIG.projectsDir;
  if (!existsSync(projectsDir)) return null;

  for (const projectDir of readdirSync(projectsDir)) {
    const filePath = join(projectsDir, projectDir, `${sessionId}.jsonl`);
    if (existsSync(filePath)) {
      return parseSessionFile(filePath, projectDir);
    }
  }
  return null;
}

function findLatestSessionForProject(
  projectQuery: string
): ParsedSession | null {
  const entries = parseTranscriptHistory();
  const query = projectQuery.toLowerCase();

  // Find matching project entries
  const matching = entries.filter(
    (e) =>
      e.project.toLowerCase().includes(query) ||
      extractProjectName(e.project).toLowerCase().includes(query)
  );

  if (matching.length === 0) return null;

  // Group by session and find most recent
  const bySession = groupBySession(matching);
  let latestSessionId = "";
  let latestTimestamp = 0;

  for (const [sessionId, sessionEntries] of bySession) {
    const maxTs = Math.max(...sessionEntries.map((e) => e.timestamp));
    if (maxTs > latestTimestamp) {
      latestTimestamp = maxTs;
      latestSessionId = sessionId;
    }
  }

  if (!latestSessionId) return null;
  return findSessionById(latestSessionId);
}

function formatSessionSummary(session: ParsedSession): string {
  const projectName = extractProjectName(session.project);
  const startDate = session.startTime
    ? new Date(session.startTime).toLocaleString()
    : "unknown";
  const endDate = session.endTime
    ? new Date(session.endTime).toLocaleString()
    : "unknown";

  const userMessages = session.messages.filter((m) => m.role === "user");
  const assistantMessages = session.messages.filter(
    (m) => m.role === "assistant"
  );
  const allTools = session.messages.flatMap((m) => m.toolNames);
  const uniqueTools = [...new Set(allTools)];

  // Extract first user message as "topic"
  const topic =
    userMessages.length > 0
      ? userMessages[0].text.slice(0, 200)
      : "Unknown topic";

  // Extract key topics from user messages
  const userTexts = userMessages.map((m) => m.text).join(" ");
  const keyPhrases = extractKeyPhrases(userTexts);

  const lines: string[] = [
    `## Session Summary: ${projectName}`,
    "",
    `**Session ID**: ${session.sessionId}`,
    `**Project**: ${session.project}`,
    `**Branch**: ${session.gitBranch || "unknown"}`,
    `**Time**: ${startDate} → ${endDate}`,
    `**Messages**: ${userMessages.length} user, ${assistantMessages.length} assistant`,
    "",
    `### Initial Topic`,
    topic,
    "",
  ];

  if (uniqueTools.length > 0) {
    lines.push(`### Tools Used`);
    lines.push(uniqueTools.join(", "));
    lines.push("");
  }

  if (keyPhrases.length > 0) {
    lines.push(`### Key Topics`);
    for (const phrase of keyPhrases.slice(0, 10)) {
      lines.push(`- ${phrase}`);
    }
    lines.push("");
  }

  // Include last few user messages as "conversation flow"
  if (userMessages.length > 1) {
    lines.push(`### Conversation Flow`);
    const recentMessages = userMessages.slice(-5);
    for (const msg of recentMessages) {
      const text =
        msg.text.length > 150 ? msg.text.slice(0, 150) + "..." : msg.text;
      lines.push(`- ${text}`);
    }
  }

  return lines.join("\n");
}

function extractKeyPhrases(text: string): string[] {
  // Simple heuristic: find quoted strings, error messages, file paths, and key terms
  const phrases: string[] = [];

  // Quoted strings
  const quoted = text.match(/"[^"]{3,50}"/g);
  if (quoted) phrases.push(...quoted.map((q) => q.replace(/"/g, "")));

  // Error-like patterns
  const errors = text.match(
    /(?:error|Error|ERROR|exception|Exception|failed|FAILED)[:\s][^\n.]{5,80}/g
  );
  if (errors) phrases.push(...errors.slice(0, 3));

  return [...new Set(phrases)].slice(0, 10);
}
