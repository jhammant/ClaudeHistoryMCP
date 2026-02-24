/**
 * Incremental indexer: re-indexes only changed files.
 * Integrates with file watcher and knowledge extraction.
 */

import { join } from "path";
import { statSync } from "fs";
import { CONFIG } from "../config.js";
import { IndexManager } from "../indexing/index-manager.js";
import { parseSessionFile } from "../parsers/session-parser.js";
import { extractKnowledge } from "../knowledge/knowledge-extractor.js";
import { KnowledgeStore } from "../knowledge/knowledge-store.js";
import {
  summarizeSession,
  cacheSummary,
} from "../knowledge/session-summarizer.js";
import { synthesizeLearnings } from "../knowledge/learning-synthesizer.js";
import { writeLearningsToMemory } from "../knowledge/memory-writer.js";
import { FileWatcher } from "./file-watcher.js";

export class IncrementalIndexer {
  private watcher: FileWatcher;
  private indexManager: IndexManager;
  private knowledgeStore: KnowledgeStore;
  private processing = new Set<string>();

  constructor(indexManager: IndexManager, knowledgeStore: KnowledgeStore) {
    this.watcher = new FileWatcher();
    this.indexManager = indexManager;
    this.knowledgeStore = knowledgeStore;
  }

  /**
   * Start watching and auto-indexing.
   */
  start(): void {
    this.watcher.start((filename) => {
      this.handleFileChange(filename).catch(() => {});
    });
  }

  stop(): void {
    this.watcher.stop();
  }

  private async handleFileChange(filename: string): Promise<void> {
    if (this.processing.has(filename)) return;
    this.processing.add(filename);

    try {
      // filename is relative like: -Users-jon-dev-ghostty/sessionId.jsonl
      const parts = filename.split("/");
      if (parts.length < 2) return;

      const projectDir = parts[0];
      const filePath = join(CONFIG.projectsDir, filename);

      let stat;
      try {
        stat = statSync(filePath);
      } catch {
        return;
      }

      // Check if file hasn't been modified recently (session likely ended)
      const ageMinutes = (Date.now() - stat.mtimeMs) / 60000;
      if (ageMinutes < CONFIG.watcher.staleSessionMinutes) {
        // Still active, skip for now
        return;
      }

      // Re-index this file
      await this.indexManager.incrementalUpdate();
      await this.indexManager.save();

      // Extract knowledge from the session
      const session = parseSessionFile(filePath, projectDir);
      if (session) {
        const knowledge = extractKnowledge(session);
        for (const entry of knowledge) {
          this.knowledgeStore.addEntry(entry);
        }
        if (knowledge.length > 0) {
          this.knowledgeStore.save();

          // Run synthesis after new knowledge is extracted
          const newLearnings = synthesizeLearnings(this.knowledgeStore);
          if (newLearnings.length > 0) {
            this.knowledgeStore.save();
            // Write learnings to the project's MEMORY.md
            const projectLearnings =
              this.knowledgeStore.getGlobalLearnings(projectDir);
            writeLearningsToMemory(projectDir, projectLearnings);
          }
        }

        // Cache summary
        const summary = summarizeSession(session);
        cacheSummary(summary);
      }
    } finally {
      this.processing.delete(filename);
    }
  }
}
