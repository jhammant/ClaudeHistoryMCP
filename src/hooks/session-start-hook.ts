#!/usr/bin/env node

/**
 * Session-start hook: auto-inject project context on new Claude Code session.
 *
 * Reads pre-computed summaries and knowledge directly from ~/.claude-history-mcp/
 * and outputs brief context to stdout. Target: <200ms.
 *
 * Register in ~/.claude/settings.json as a SessionStart hook.
 */

import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { encodeProjectPath, extractProjectName } from "../utils/path-encoder.js";
import { CONFIG } from "../config.js";
import type { SessionSummary } from "../knowledge/session-summarizer.js";
import type { KnowledgeEntry } from "../knowledge/knowledge-store.js";
import type { RecurringIssue } from "../knowledge/learning-synthesizer.js";

function main(): void {
  const cwd = process.cwd();
  const projectDir = encodeProjectPath(cwd);
  const projectName = extractProjectName(cwd);

  // Load recent summaries for this project
  const summaries = loadProjectSummaries(projectDir);
  const knowledge = loadProjectKnowledge(projectDir);
  const globalLearnings = loadLearnings(projectDir);
  const recurringIssue = loadTopRecurringIssue();

  if (
    summaries.length === 0 &&
    knowledge.length === 0 &&
    globalLearnings.length === 0 &&
    !recurringIssue
  ) {
    return;
  }

  const lines: string[] = [`[ClaudeHistory] Previous context for ${projectName}:`];

  // Show last 3 session summaries
  for (const summary of summaries.slice(0, 3)) {
    const daysAgo = Math.floor((Date.now() - summary.endTime) / 86400000);
    const timeStr =
      daysAgo === 0
        ? "today"
        : daysAgo === 1
          ? "yesterday"
          : `${daysAgo} days ago`;
    const topic =
      summary.topic.length > 80
        ? summary.topic.slice(0, 80) + "..."
        : summary.topic;
    lines.push(`- Last session (${timeStr}): ${topic}`);
  }

  // Show key decisions/solutions
  const decisions = knowledge.filter((k) => k.type === "decision").slice(0, 2);
  for (const d of decisions) {
    lines.push(`- Key decision: ${d.summary}`);
  }

  const solutions = knowledge.filter((k) => k.type === "solution").slice(0, 2);
  for (const s of solutions) {
    lines.push(`- Solution found: ${s.summary}`);
  }

  // Show unresolved issues (errors without fixes)
  const errorFixes = knowledge.filter((k) => k.type === "error_fix").slice(0, 1);
  for (const ef of errorFixes) {
    lines.push(`- Error fix: ${ef.summary}`);
  }

  // Show synthesized learnings (max 3)
  for (const l of globalLearnings.slice(0, 3)) {
    lines.push(`- Learning: ${l.summary}`);
  }

  // Show top recurring issue
  if (recurringIssue) {
    lines.push(
      `- Recurring: ${recurringIssue.tag} issues (${recurringIssue.count} occurrences)`
    );
  }

  if (lines.length > 1) {
    console.log(lines.join("\n"));
  }
}

function loadProjectSummaries(projectDir: string): SessionSummary[] {
  const summariesDir = CONFIG.summariesDir;
  if (!existsSync(summariesDir)) return [];

  const summaries: SessionSummary[] = [];
  try {
    for (const file of readdirSync(summariesDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(
          readFileSync(join(summariesDir, file), "utf-8")
        ) as SessionSummary;
        if (data.project === projectDir || data.project.includes(projectDir)) {
          summaries.push(data);
        }
      } catch {
        continue;
      }
    }
  } catch {
    return [];
  }

  return summaries.sort((a, b) => b.endTime - a.endTime);
}

function loadProjectKnowledge(projectDir: string): KnowledgeEntry[] {
  if (!existsSync(CONFIG.knowledgeFile)) return [];

  try {
    const entries = JSON.parse(
      readFileSync(CONFIG.knowledgeFile, "utf-8")
    ) as KnowledgeEntry[];
    return entries
      .filter(
        (e) =>
          e.type !== "learning" &&
          (e.project === projectDir || e.project.includes(projectDir))
      )
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

function loadLearnings(projectDir: string): KnowledgeEntry[] {
  if (!existsSync(CONFIG.knowledgeFile)) return [];

  try {
    const entries = JSON.parse(
      readFileSync(CONFIG.knowledgeFile, "utf-8")
    ) as KnowledgeEntry[];
    return entries
      .filter(
        (e) =>
          e.type === "learning" &&
          (e.project === "_global" ||
            e.project === projectDir ||
            e.project.includes(projectDir))
      )
      .sort((a, b) => (b.occurrences ?? 0) - (a.occurrences ?? 0));
  } catch {
    return [];
  }
}

function loadTopRecurringIssue(): RecurringIssue | null {
  if (!existsSync(CONFIG.recurringIssuesFile)) return null;

  try {
    const issues = JSON.parse(
      readFileSync(CONFIG.recurringIssuesFile, "utf-8")
    ) as RecurringIssue[];
    return issues.length > 0 ? issues[0] : null;
  } catch {
    return null;
  }
}

main();
