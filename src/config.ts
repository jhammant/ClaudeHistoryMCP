import { homedir } from "os";
import { join } from "path";

export const CONFIG = {
  claudeDir: join(homedir(), ".claude"),
  get historyFile() {
    return join(this.claudeDir, "history.jsonl");
  },
  get projectsDir() {
    return join(this.claudeDir, "projects");
  },
  get settingsFile() {
    return join(this.claudeDir, "settings.json");
  },

  dataDir: join(homedir(), ".claude-history-mcp"),
  get indexFile() {
    return join(this.dataDir, "index.msgpack");
  },
  get knowledgeFile() {
    return join(this.dataDir, "knowledge.json");
  },
  get summariesDir() {
    return join(this.dataDir, "summaries");
  },
  get metaFile() {
    return join(this.dataDir, "meta.json");
  },
  get recurringIssuesFile() {
    return join(this.dataDir, "recurring-issues.json");
  },

  // BM25 parameters
  bm25: {
    k1: 1.2,
    b: 0.75,
  },

  // TF-IDF parameters
  tfidf: {
    maxTerms: 10000,
  },

  // Search defaults
  search: {
    defaultLimit: 20,
    maxLimit: 100,
    contextLines: 3,
    // Recency boosts
    recencyBoost7d: 1.2,
    recencyBoost30d: 1.1,
    // Project match boost
    projectMatchBoost: 1.3,
    // RRF constant
    rrfK: 60,
  },

  // Indexing
  indexing: {
    chunkSize: 500, // tokens per chunk
    chunkOverlap: 50,
    maxChunksPerSession: 200,
  },

  // File watcher
  watcher: {
    debounceMs: 5000,
    staleSessionMinutes: 5,
  },

  // Learning synthesis
  learning: {
    similarityThreshold: 0.6,  // Jaccard similarity for clustering
    promotionThreshold: 10,    // Minimum score to promote to learning
    maxLearningsPerProject: 10,
    maxLearningLength: 120,    // Max chars per learning summary
    memoryLineBudget: 200,     // Max lines in MEMORY.md
  },
} as const;
