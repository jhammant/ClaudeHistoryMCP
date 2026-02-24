/**
 * Learning synthesizer: cluster similar knowledge entries, score them,
 * and promote recurring patterns into synthesized "learning" entries.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { CONFIG } from "../config.js";
import { stem } from "../utils/stemmer.js";
import type { KnowledgeEntry } from "./knowledge-store.js";
import type { KnowledgeStore } from "./knowledge-store.js";

export interface RecurringIssue {
  tag: string;
  count: number;
  summary: string;
}

interface Cluster {
  key: string;
  entries: KnowledgeEntry[];
  tags: Set<string>;
  sessions: Set<string>;
  projects: Set<string>;
}

/**
 * Run the full synthesis pipeline: cluster → score → promote learnings.
 * Returns newly created learning entries.
 */
export function synthesizeLearnings(store: KnowledgeStore): KnowledgeEntry[] {
  const allEntries = store.getAllEntries();
  const candidates = allEntries.filter(
    (e) => e.type === "solution" || e.type === "error_fix"
  );

  if (candidates.length === 0) return [];

  // Step 1: Cluster by similarity
  const clusters = clusterEntries(candidates);

  // Step 2: Score and promote
  const newLearnings: KnowledgeEntry[] = [];
  const threshold = CONFIG.learning.promotionThreshold;

  for (const cluster of clusters) {
    const score = scoreCluster(cluster);
    if (score < threshold) continue;

    const id = deterministicId(cluster.key);
    if (store.hasEntry(id)) continue;

    const learning = createLearning(cluster, id);
    store.addEntry(learning);
    newLearnings.push(learning);
  }

  // Also build recurring issues cache
  const issues = buildRecurringIssues(allEntries);
  saveRecurringIssues(issues);

  return newLearnings;
}

/**
 * Group entries into clusters by tag overlap + summary similarity.
 */
export function clusterEntries(entries: readonly KnowledgeEntry[]): Cluster[] {
  const clusters: Cluster[] = [];

  for (const entry of entries) {
    let bestCluster: Cluster | null = null;
    let bestSim = 0;

    for (const cluster of clusters) {
      // Must share at least one tag
      const sharedTags = entry.tags.filter((t) => cluster.tags.has(t));
      if (sharedTags.length === 0) continue;

      // Compute Jaccard similarity on stemmed words
      const sim = jaccardSimilarity(
        stemmedWords(cluster.entries[0].summary),
        stemmedWords(entry.summary)
      );
      if (sim > bestSim) {
        bestSim = sim;
        bestCluster = cluster;
      }
    }

    if (bestCluster && bestSim >= CONFIG.learning.similarityThreshold) {
      bestCluster.entries.push(entry);
      for (const t of entry.tags) bestCluster.tags.add(t);
      bestCluster.sessions.add(entry.sessionId);
      bestCluster.projects.add(entry.project);
    } else {
      clusters.push({
        key: normalizeKey(entry.summary, entry.tags),
        entries: [entry],
        tags: new Set(entry.tags),
        sessions: new Set([entry.sessionId]),
        projects: new Set([entry.project]),
      });
    }
  }

  return clusters;
}

/**
 * Score a cluster for promotion to a learning.
 *
 * - Frequency: min(count, 10) * 2          (max 20)
 * - Cross-session: min(sessions, 5) * 3    (max 15)
 * - Cross-project: min(projects, 3) * 5    (max 15)
 * - Error-fix bonus: +5 if ≥2 error_fixes
 */
export function scoreCluster(cluster: Cluster): number {
  const count = cluster.entries.length;
  const sessions = cluster.sessions.size;
  const projects = cluster.projects.size;
  const errorFixes = cluster.entries.filter((e) => e.type === "error_fix").length;

  let score = 0;
  score += Math.min(count, 10) * 2;
  score += Math.min(sessions, 5) * 3;
  score += Math.min(projects, 3) * 5;
  if (errorFixes >= 2) score += 5;

  return score;
}

/**
 * Create a learning entry from a cluster.
 * Picks the shortest clear summary and appends occurrence metadata.
 */
function createLearning(cluster: Cluster, id: string): KnowledgeEntry {
  // Pick the shortest summary as the clearest one
  const sorted = [...cluster.entries].sort(
    (a, b) => a.summary.length - b.summary.length
  );
  const baseSummary = sorted[0].summary;

  const count = cluster.entries.length;
  const projectCount = cluster.projects.size;
  const suffix =
    projectCount > 1
      ? ` (seen ${count} times across ${projectCount} projects)`
      : ` (seen ${count} times)`;

  let summary = baseSummary + suffix;
  if (summary.length > CONFIG.learning.maxLearningLength) {
    const maxBase = CONFIG.learning.maxLearningLength - suffix.length;
    summary = baseSummary.slice(0, maxBase - 3) + "..." + suffix;
  }

  return {
    id,
    type: "learning",
    project: projectCount > 1 ? "_global" : [...cluster.projects][0],
    sessionId: "_synthesized",
    timestamp: Date.now(),
    summary,
    details: `Synthesized from ${count} entries across ${cluster.sessions.size} sessions`,
    tags: [...cluster.tags],
    relatedFiles: [],
    occurrences: count,
    projectCount,
  };
}

/**
 * Build a list of recurring issues from knowledge entries grouped by tag.
 */
function buildRecurringIssues(entries: readonly KnowledgeEntry[]): RecurringIssue[] {
  const tagCounts = new Map<string, { count: number; summaries: string[] }>();

  for (const entry of entries) {
    if (entry.type !== "error_fix" && entry.type !== "solution") continue;
    for (const tag of entry.tags) {
      const existing = tagCounts.get(tag) ?? { count: 0, summaries: [] };
      existing.count++;
      if (existing.summaries.length < 3) {
        existing.summaries.push(entry.summary);
      }
      tagCounts.set(tag, existing);
    }
  }

  return [...tagCounts.entries()]
    .filter(([, v]) => v.count >= 2)
    .map(([tag, v]) => ({
      tag,
      count: v.count,
      summary: v.summaries[0],
    }))
    .sort((a, b) => b.count - a.count);
}

function saveRecurringIssues(issues: RecurringIssue[]): void {
  const filePath = CONFIG.recurringIssuesFile;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(issues, null, 2));
}

/**
 * Compute Jaccard similarity between two sets of strings.
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Normalize text into a set of stemmed words.
 */
export function stemmedWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => stem(w))
  );
}

/**
 * Generate a deterministic ID from a cluster's normalized key.
 */
function deterministicId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/**
 * Create a stable key for a cluster from summary + tags.
 */
function normalizeKey(summary: string, tags: string[]): string {
  const stemmed = [...stemmedWords(summary)].sort().join(" ");
  const sortedTags = [...tags].sort().join(",");
  return `${sortedTags}:${stemmed}`;
}
