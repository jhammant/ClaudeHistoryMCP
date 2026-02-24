/**
 * Safely write synthesized learnings into project MEMORY.md files.
 * Uses sentinel markers to manage a section without touching user content.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { CONFIG } from "../config.js";
import type { KnowledgeEntry } from "./knowledge-store.js";

const BEGIN_MARKER = "<!-- BEGIN CLAUDE_HISTORY_LEARNINGS -->";
const END_MARKER = "<!-- END CLAUDE_HISTORY_LEARNINGS -->";
const SECTION_HEADER = "## Learnings (auto-managed by ClaudeHistoryMCP)";

/**
 * Write learnings to a project's MEMORY.md file.
 * Only writes to the managed section between sentinel markers.
 */
export function writeLearningsToMemory(
  projectPath: string,
  learnings: KnowledgeEntry[]
): void {
  const memoryDir = join(
    CONFIG.claudeDir,
    "projects",
    projectPath,
    "memory"
  );
  const memoryFile = join(memoryDir, "MEMORY.md");

  if (learnings.length === 0) return;

  // Limit to configured max
  const maxLearnings = CONFIG.learning.maxLearningsPerProject;
  const topLearnings = learnings.slice(0, maxLearnings);

  // Format learning lines
  const learningLines = topLearnings.map(
    (l) => `- ${truncate(l.summary, CONFIG.learning.maxLearningLength)}`
  );

  // Read existing file or start fresh
  let existingContent = "";
  if (existsSync(memoryFile)) {
    existingContent = readFileSync(memoryFile, "utf-8");
  }

  // Calculate line budget
  const userLines = getUserLineCount(existingContent);
  const budgetRemaining = CONFIG.learning.memoryLineBudget - userLines;

  // Need at least: header (1) + begin marker (1) + end marker (1) + 1 learning = 4 lines
  if (budgetRemaining < 4) return;

  // Trim learnings to fit budget (header + markers = 3 lines overhead)
  const maxLearningLines = budgetRemaining - 3;
  const fittedLines = learningLines.slice(0, maxLearningLines);
  if (fittedLines.length === 0) return;

  // Build the managed section
  const managedSection = [
    SECTION_HEADER,
    BEGIN_MARKER,
    ...fittedLines,
    END_MARKER,
  ].join("\n");

  // Replace existing managed section or append
  const newContent = replaceManagedSection(existingContent, managedSection);

  // Ensure directory exists
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }

  writeFileSync(memoryFile, newContent);
}

/**
 * Replace the managed section between markers, or append it.
 */
function replaceManagedSection(
  content: string,
  newSection: string
): string {
  // Find existing managed section (including header line before BEGIN)
  const headerIdx = content.indexOf(SECTION_HEADER);
  const endIdx = content.indexOf(END_MARKER);

  if (headerIdx !== -1 && endIdx !== -1) {
    // Replace from header through end marker
    const before = content.slice(0, headerIdx).trimEnd();
    const after = content.slice(endIdx + END_MARKER.length).trimStart();

    const parts = [before, newSection];
    if (after.length > 0) parts.push(after);
    return parts.filter(Boolean).join("\n\n") + "\n";
  }

  // Check for markers without header (shouldn't happen, but handle gracefully)
  const beginIdx = content.indexOf(BEGIN_MARKER);
  if (beginIdx !== -1 && endIdx !== -1) {
    const before = content.slice(0, beginIdx).trimEnd();
    const after = content.slice(endIdx + END_MARKER.length).trimStart();

    const parts = [before, newSection];
    if (after.length > 0) parts.push(after);
    return parts.filter(Boolean).join("\n\n") + "\n";
  }

  // No existing section — append
  if (content.trim().length === 0) {
    return newSection + "\n";
  }
  return content.trimEnd() + "\n\n" + newSection + "\n";
}

/**
 * Count lines of user content (everything outside the managed section).
 */
function getUserLineCount(content: string): number {
  if (content.trim().length === 0) return 0;

  const headerIdx = content.indexOf(SECTION_HEADER);
  const endIdx = content.indexOf(END_MARKER);

  if (headerIdx !== -1 && endIdx !== -1) {
    const before = content.slice(0, headerIdx);
    const after = content.slice(endIdx + END_MARKER.length);
    const userContent = before + after;
    return userContent.split("\n").filter((l) => l.trim().length > 0).length;
  }

  return content.split("\n").filter((l) => l.trim().length > 0).length;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Filter learnings by relevance to a project's tags.
 */
export function filterLearningsForProject(
  learnings: KnowledgeEntry[],
  projectTags: string[]
): KnowledgeEntry[] {
  if (projectTags.length === 0) return learnings;

  const tagSet = new Set(projectTags.map((t) => t.toLowerCase()));
  return learnings.filter((l) => {
    // Global learnings with high occurrence always qualify
    if ((l.occurrences ?? 0) >= 5) return true;
    // Otherwise need tag overlap
    return l.tags.some((t) => tagSet.has(t.toLowerCase()));
  });
}
