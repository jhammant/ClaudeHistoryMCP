/**
 * Build HistoryEntry[] from REAL session transcripts in ~/.claude/projects/**\/*.jsonl.
 *
 * WHY: The global prompt-history file ~/.claude/history.jsonl is almost never
 * written under VSCode-extension / Agent-SDK usage, so the tools that relied on
 * it (list_projects, find_patterns, get_project_context, get_session_summary's
 * by-project lookup) massively undercount projects/sessions/messages. The actual
 * conversation data lives in the per-session transcript files, which are reliably
 * written. This module derives the same HistoryEntry[] shape from those transcripts
 * so downstream helpers and tool bodies stay unchanged — only the data source swaps.
 *
 * Semantics: one HistoryEntry == one GENUINE user prompt, matching the original
 * history.jsonl semantics (each line was a user prompt). Tool-result user turns,
 * meta turns, and empty turns are skipped, keeping `display` meaningful for
 * topic/issue analysis and message counts sane.
 */

import { readFileSync } from "fs";
import { HistoryEntry } from "./history-parser.js";
import { enumerateSessionFiles } from "./session-parser.js";
import { stripSystemReminders } from "./content-extractor.js";

/**
 * Normalize a transcript timestamp into an ms-epoch number.
 * Numbers are used as-is; ISO strings are parsed (NaN guarded to 0); anything else -> 0.
 */
function toMs(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const n = new Date(ts).getTime();
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

// Leading-tag patterns for content Claude Code injects into the user role
// that are NOT genuine human prompts. Matched case-insensitively at the very
// start of the (trimmed) message text, after system-reminder stripping.
const INJECTED_TAG_RE =
  /^<\/?(?:task-notification|ide_opened_file|ide_selection|ide_diagnostics|command-name|command-message|command-args|local-command-stdout|local-command-stderr|bash-input|bash-stdout|bash-stderr|user-prompt-submit-hook)\b/i;

function isInjectedNoise(text: string): boolean {
  return INJECTED_TAG_RE.test(text.trimStart());
}

/**
 * PURE: parse one transcript file's raw content into genuine user-prompt entries.
 *
 * The session's project is resolved from the FIRST `cwd` seen in the file
 * (accurate, handles worktrees, avoids lossy dash-encoding); if no cwd is present
 * the provided fallbackProject (the raw encoded project dir, which
 * extractProjectName handles downstream) is used. The resolved project is then
 * applied to every entry of the session.
 */
export function parseSessionUserPrompts(
  content: string,
  sessionId: string,
  fallbackProject: string
): HistoryEntry[] {
  const provisional: { display: string; timestamp: number }[] = [];
  let cwd = "";

  for (const line of content.split("\n")) {
    if (!line.trim()) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // Skip malformed JSON lines
    }

    // Capture the first cwd seen, regardless of line type.
    if (typeof obj.cwd === "string" && obj.cwd && !cwd) cwd = obj.cwd;

    if (obj.type !== "user") continue;
    if (obj.isMeta === true) continue; // Meta turns are not genuine prompts
    if (obj.toolUseResult !== undefined) continue; // Tool-result user turns are not prompts

    const message = obj.message as
      | { role?: string; content?: unknown }
      | undefined;
    if (!message) continue;

    const c = message.content;
    let text = "";
    if (typeof c === "string") {
      text = stripSystemReminders(c);
    } else if (Array.isArray(c)) {
      const parts: string[] = [];
      for (const b of c) {
        if (
          b &&
          typeof b === "object" &&
          (b as { type?: unknown }).type === "text" &&
          typeof (b as { text?: unknown }).text === "string"
        ) {
          parts.push((b as { text: string }).text);
        }
      }
      text = stripSystemReminders(parts.join("\n"));
    }

    text = text.trim();
    if (!text) continue; // Skip empty / non-text-only turns
    if (isInjectedNoise(text)) continue; // Skip Claude Code injected non-prompt turns

    provisional.push({ display: text, timestamp: toMs(obj.timestamp) });
  }

  const project = cwd || fallbackProject;
  return provisional.map((p) => ({
    display: p.display,
    timestamp: p.timestamp,
    project,
    sessionId,
  }));
}

// Per-file cache so only changed files are re-read/parsed, instead of an
// all-or-nothing global signature that invalidates everything on any change.
interface FileCacheEntry { mtime: number; size: number; entries: HistoryEntry[]; }
const fileCache = new Map<string, FileCacheEntry>();

/**
 * Build HistoryEntry[] from all real session transcripts, with per-file caching.
 */
export function parseTranscriptHistory(): HistoryEntry[] {
  const files = enumerateSessionFiles();
  const seen = new Set<string>();
  const result: HistoryEntry[] = [];

  for (const f of files) {
    seen.add(f.filePath);
    const cached = fileCache.get(f.filePath);
    if (cached && cached.mtime === f.mtime && cached.size === f.size) {
      result.push(...cached.entries);
      continue;
    }
    let content: string;
    try {
      content = readFileSync(f.filePath, "utf-8");
    } catch {
      fileCache.delete(f.filePath);
      continue;
    }
    const entries = parseSessionUserPrompts(content, f.sessionId, f.projectDir);
    fileCache.set(f.filePath, { mtime: f.mtime, size: f.size, entries });
    result.push(...entries);
  }

  // Prune cache entries for files that no longer exist (collect-then-delete to
  // avoid mutating the Map while iterating).
  const stale: string[] = [];
  for (const key of fileCache.keys()) if (!seen.has(key)) stale.push(key);
  for (const key of stale) fileCache.delete(key);

  return result;
}
