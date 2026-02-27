/**
 * Track sync state: last push/pull timestamps for incremental sync.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { CONFIG } from "../config.js";

interface SyncState {
  lastPushKnowledge: number; // epoch ms
  lastPushSessions: number;
  lastPullKnowledge: number;
  lastPullSessions: number;
  pushCount: number;
  pullCount: number;
}

const DEFAULT_STATE: SyncState = {
  lastPushKnowledge: 0,
  lastPushSessions: 0,
  lastPullKnowledge: 0,
  lastPullSessions: 0,
  pushCount: 0,
  pullCount: 0,
};

let cached: SyncState | null = null;

export function loadSyncState(): SyncState {
  if (cached) return cached;
  const file = CONFIG.syncStateFile;
  if (!existsSync(file)) {
    cached = { ...DEFAULT_STATE };
    return cached;
  }
  try {
    cached = { ...DEFAULT_STATE, ...JSON.parse(readFileSync(file, "utf-8")) };
    return cached!;
  } catch {
    cached = { ...DEFAULT_STATE };
    return cached;
  }
}

export function saveSyncState(state: SyncState): void {
  const dir = dirname(CONFIG.syncStateFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG.syncStateFile, JSON.stringify(state, null, 2));
  cached = state;
}

export function updateSyncState(updates: Partial<SyncState>): SyncState {
  const state = { ...loadSyncState(), ...updates };
  saveSyncState(state);
  return state;
}
