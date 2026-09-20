import {
  groupByProject,
  groupBySession,
} from "../parsers/history-parser.js";
import { parseTranscriptHistory } from "../parsers/transcript-history.js";
import { extractProjectName } from "../utils/path-encoder.js";

export const findPatternsTool = {
  name: "find_patterns",
  description:
    "Discover recurring patterns in conversation history: common topics, frequent workflows, repeated issues.",
  inputSchema: {
    type: "object" as const,
    properties: {
      project: {
        type: "string",
        description: "Limit to a specific project",
      },
      type: {
        type: "string",
        enum: ["topics", "workflows", "issues", "all"],
        description:
          "Type of patterns to find (default: all)",
      },
    },
  },
};

export function handleFindPatterns(args: {
  project?: string;
  type?: string;
}): string {
  const entries = parseTranscriptHistory();
  const patternType = args.type || "all";

  let filtered = entries;
  if (args.project) {
    const query = args.project.toLowerCase();
    filtered = entries.filter(
      (e) =>
        e.project.toLowerCase().includes(query) ||
        extractProjectName(e.project).toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    return args.project
      ? `No history found for project "${args.project}".`
      : "No conversation history found.";
  }

  const lines: string[] = ["## Patterns Found\n"];

  if (patternType === "all" || patternType === "topics") {
    lines.push("### Recurring Topics");
    const topics = findTopicPatterns(filtered);
    if (topics.length > 0) {
      for (const t of topics) lines.push(`- ${t}`);
    } else {
      lines.push("- No recurring topics detected");
    }
    lines.push("");
  }

  if (patternType === "all" || patternType === "workflows") {
    lines.push("### Activity Patterns");
    const workflows = findActivityPatterns(filtered);
    for (const w of workflows) lines.push(`- ${w}`);
    lines.push("");
  }

  if (patternType === "all" || patternType === "issues") {
    lines.push("### Repeated Issues");
    const issues = findRepeatedIssues(filtered);
    if (issues.length > 0) {
      for (const i of issues) lines.push(`- ${i}`);
    } else {
      lines.push("- No repeated issues detected");
    }
    lines.push("");
  }

  return lines.join("\n");
}

function findTopicPatterns(
  entries: Array<{ display: string; project: string }>
): string[] {
  // Find frequently occurring meaningful words
  const wordCounts = new Map<string, number>();
  const stopWords = new Set([
    "the", "a", "an", "is", "it", "to", "for", "and", "or", "but",
    "in", "on", "at", "by", "with", "from", "that", "this", "can",
    "do", "did", "does", "has", "have", "had", "not", "all", "are",
    "was", "were", "will", "would", "should", "could", "may", "might",
    "i", "me", "my", "we", "you", "your", "let", "just", "want",
  ]);

  for (const entry of entries) {
    const words = entry.display
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopWords.has(w));
    const uniqueWords = new Set(words);
    for (const word of uniqueWords) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  }

  return [...wordCounts.entries()]
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word, count]) => `"${word}" — mentioned in ${count} messages`);
}

function findActivityPatterns(
  entries: Array<{ timestamp: number; project: string; sessionId: string }>
): string[] {
  const patterns: string[] = [];

  // Sessions per day of week
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayCounts = new Array(7).fill(0);
  const hourCounts = new Array(24).fill(0);

  for (const entry of entries) {
    if (entry.timestamp) {
      const d = new Date(entry.timestamp);
      dayCounts[d.getDay()]++;
      hourCounts[d.getHours()]++;
    }
  }

  const busiestDay = dayCounts.indexOf(Math.max(...dayCounts));
  patterns.push(
    `Most active day: ${dayNames[busiestDay]} (${dayCounts[busiestDay]} messages)`
  );

  const busiestHour = hourCounts.indexOf(Math.max(...hourCounts));
  patterns.push(
    `Most active hour: ${busiestHour}:00 (${hourCounts[busiestHour]} messages)`
  );

  // Average session length
  const bySession = groupBySession(entries as Array<{ display: string; timestamp: number; project: string; sessionId: string }>);
  const sessionLengths: number[] = [];
  for (const [_, sessionEntries] of bySession) {
    sessionLengths.push(sessionEntries.length);
  }
  if (sessionLengths.length > 0) {
    const avg = sessionLengths.reduce((a, b) => a + b, 0) / sessionLengths.length;
    patterns.push(`Average session length: ${avg.toFixed(1)} messages`);
    patterns.push(`Total sessions: ${sessionLengths.length}`);
  }

  return patterns;
}

function findRepeatedIssues(
  entries: Array<{ display: string }>
): string[] {
  // Look for error/issue language
  const issuePatterns = entries
    .filter((e) => {
      const lower = e.display.toLowerCase();
      return (
        lower.includes("error") ||
        lower.includes("fix") ||
        lower.includes("bug") ||
        lower.includes("broken") ||
        lower.includes("failing") ||
        lower.includes("not working") ||
        lower.includes("issue")
      );
    })
    .map((e) => e.display);

  if (issuePatterns.length === 0) return [];

  // Group similar issues (very simple: by first 5 significant words)
  const grouped = new Map<string, number>();
  for (const issue of issuePatterns) {
    const key = issue
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 5)
      .join(" ");
    if (key) grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  return [...grouped.entries()]
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([issue, count]) => `"${issue}" (${count} occurrences)`);
}
