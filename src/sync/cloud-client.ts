/**
 * HTTP client for the ClaudeHistory Cloud API.
 * Handles push/pull of knowledge entries and session summaries.
 */

import { CONFIG } from "../config.js";
import type { KnowledgeEntry } from "../knowledge/knowledge-store.js";
import type { SessionSummary } from "../knowledge/session-summarizer.js";

export interface SyncResult {
  success: boolean;
  error?: string;
}

export interface PushKnowledgeResult extends SyncResult {
  accepted: number;
  skipped: number;
}

export interface PushSessionsResult extends SyncResult {
  accepted: number;
  updated: number;
}

export interface PullKnowledgeResult extends SyncResult {
  entries: CloudKnowledgeEntry[];
}

export interface PullSessionsResult extends SyncResult {
  summaries: CloudSessionSummary[];
}

export interface CloudKnowledgeEntry {
  id: string;
  type: string;
  project: string | null;
  session_id: string | null;
  timestamp: number;
  summary: string;
  details: string | null;
  tags: string[];
  related_files: string[];
  created_at: string;
  updated_at: string;
}

export interface CloudSessionSummary {
  id: string;
  session_id: string;
  project: string | null;
  summary: Record<string, unknown>;
  created_at: string;
}

function getHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": CONFIG.cloud.apiKey,
  };
}

function getBaseUrl(): string {
  return CONFIG.cloud.apiUrl.replace(/\/$/, "");
}

export function isCloudConfigured(): boolean {
  return !!(CONFIG.cloud.apiUrl && CONFIG.cloud.apiKey);
}

/**
 * Convert local KnowledgeEntry to cloud push format.
 */
function toCloudKnowledge(entry: KnowledgeEntry) {
  return {
    type: entry.type,
    project: entry.project || undefined,
    sessionId: entry.sessionId || undefined,
    timestamp: entry.timestamp,
    summary: entry.summary,
    details: entry.details || undefined,
    tags: entry.tags.length > 0 ? entry.tags : undefined,
    relatedFiles: entry.relatedFiles.length > 0 ? entry.relatedFiles : undefined,
  };
}

/**
 * Convert local SessionSummary to cloud push format.
 */
function toCloudSession(summary: SessionSummary) {
  return {
    sessionId: summary.sessionId,
    project: summary.project || undefined,
    summary: {
      projectName: summary.projectName,
      startTime: summary.startTime,
      endTime: summary.endTime,
      duration: summary.duration,
      messageCount: summary.messageCount,
      userMessageCount: summary.userMessageCount,
      topic: summary.topic,
      keyTopics: summary.keyTopics,
      toolsUsed: summary.toolsUsed,
      filesReferenced: summary.filesReferenced,
      hasCodeChanges: summary.hasCodeChanges,
      lastUserMessage: summary.lastUserMessage,
    },
  };
}

/**
 * Convert cloud knowledge entry back to local format.
 */
export function fromCloudKnowledge(entry: CloudKnowledgeEntry): KnowledgeEntry {
  return {
    id: entry.id,
    type: entry.type as KnowledgeEntry["type"],
    project: entry.project || "",
    sessionId: entry.session_id || "",
    timestamp: entry.timestamp,
    summary: entry.summary,
    details: entry.details || "",
    tags: entry.tags || [],
    relatedFiles: entry.related_files || [],
  };
}

async function apiRequest<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const options: RequestInit = {
    method,
    headers: getHeaders(),
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);
  const data = await res.json();

  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `API error: ${res.status}`
    );
  }

  return data as T;
}

/**
 * Push knowledge entries to the cloud.
 */
export async function pushKnowledge(
  entries: KnowledgeEntry[]
): Promise<PushKnowledgeResult> {
  if (!isCloudConfigured()) {
    return { success: false, error: "Cloud sync not configured", accepted: 0, skipped: 0 };
  }
  if (entries.length === 0) {
    return { success: true, accepted: 0, skipped: 0 };
  }

  // Batch in chunks of 500 (API limit)
  const batchSize = 500;
  let totalAccepted = 0;
  let totalSkipped = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const body: { entries: ReturnType<typeof toCloudKnowledge>[]; teamId?: string } = {
      entries: batch.map(toCloudKnowledge),
    };
    if (CONFIG.cloud.teamId) body.teamId = CONFIG.cloud.teamId;

    const result = await apiRequest<{ accepted: number; skipped: number }>(
      "POST",
      "/api/sync/push/knowledge",
      body
    );
    totalAccepted += result.accepted;
    totalSkipped += result.skipped;
  }

  return { success: true, accepted: totalAccepted, skipped: totalSkipped };
}

/**
 * Push session summaries to the cloud.
 */
export async function pushSessions(
  summaries: SessionSummary[]
): Promise<PushSessionsResult> {
  if (!isCloudConfigured()) {
    return { success: false, error: "Cloud sync not configured", accepted: 0, updated: 0 };
  }
  if (summaries.length === 0) {
    return { success: true, accepted: 0, updated: 0 };
  }

  const batchSize = 200;
  let totalAccepted = 0;
  let totalUpdated = 0;

  for (let i = 0; i < summaries.length; i += batchSize) {
    const batch = summaries.slice(i, i + batchSize);
    const body: { summaries: ReturnType<typeof toCloudSession>[]; teamId?: string } = {
      summaries: batch.map(toCloudSession),
    };
    if (CONFIG.cloud.teamId) body.teamId = CONFIG.cloud.teamId;

    const result = await apiRequest<{ accepted: number; updated: number }>(
      "POST",
      "/api/sync/push/sessions",
      body
    );
    totalAccepted += result.accepted;
    totalUpdated += result.updated;
  }

  return { success: true, accepted: totalAccepted, updated: totalUpdated };
}

/**
 * Pull knowledge entries from the cloud (incremental via since timestamp).
 */
export async function pullKnowledge(
  since?: number
): Promise<PullKnowledgeResult> {
  if (!isCloudConfigured()) {
    return { success: false, error: "Cloud sync not configured", entries: [] };
  }

  let path = "/api/sync/pull/knowledge";
  const params: string[] = [];
  if (since) params.push(`since=${since}`);
  if (CONFIG.cloud.teamId) params.push(`teamId=${CONFIG.cloud.teamId}`);
  if (params.length > 0) path += `?${params.join("&")}`;

  const result = await apiRequest<{ entries: CloudKnowledgeEntry[] }>("GET", path);
  return { success: true, entries: result.entries };
}

/**
 * Pull session summaries from the cloud (incremental via since timestamp).
 */
export async function pullSessions(
  since?: number
): Promise<PullSessionsResult> {
  if (!isCloudConfigured()) {
    return { success: false, error: "Cloud sync not configured", summaries: [] };
  }

  let path = "/api/sync/pull/sessions";
  const params: string[] = [];
  if (since) params.push(`since=${since}`);
  if (CONFIG.cloud.teamId) params.push(`teamId=${CONFIG.cloud.teamId}`);
  if (params.length > 0) path += `?${params.join("&")}`;

  const result = await apiRequest<{ summaries: CloudSessionSummary[] }>("GET", path);
  return { success: true, summaries: result.summaries };
}

/**
 * Check cloud connectivity and auth.
 */
export async function checkConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
  if (!isCloudConfigured()) {
    return { ok: false, error: "Cloud sync not configured. Set CLAUDE_HISTORY_API_URL and CLAUDE_HISTORY_API_KEY environment variables." };
  }

  try {
    const result = await apiRequest<{ id: string; email: string }>("GET", "/api/auth/me");
    return { ok: true, user: result.email };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Connection failed: ${msg}` };
  }
}
