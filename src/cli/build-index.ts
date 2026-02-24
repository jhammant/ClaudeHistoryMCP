#!/usr/bin/env node

/**
 * CLI: Build the full search index from all conversation history.
 * Usage: npx tsx src/cli/build-index.ts
 */

import { IndexManager } from "../indexing/index-manager.js";
import { enumerateSessionFiles } from "../parsers/session-parser.js";
import { KnowledgeStore } from "../knowledge/knowledge-store.js";
import { synthesizeLearnings } from "../knowledge/learning-synthesizer.js";
import { writeLearningsToMemory } from "../knowledge/memory-writer.js";

async function main(): Promise<void> {
  console.log("Claude History MCP — Building Index\n");

  // Show what we're indexing
  const files = enumerateSessionFiles();
  const projects = new Set(files.map((f) => f.projectDir));
  console.log(`Found ${files.length} session files across ${projects.size} projects\n`);

  // Build index
  const indexManager = new IndexManager();
  console.log("Building search index...");
  const startTime = Date.now();
  const stats = await indexManager.buildFullIndex();
  const elapsed = Date.now() - startTime;

  console.log(`  Indexed ${stats.sessions} sessions into ${stats.chunks} chunks`);
  console.log(`  Build time: ${elapsed}ms`);

  // Save
  console.log("Saving index to disk...");
  await indexManager.save();

  // Show stats
  const indexStats = indexManager.getStats();
  console.log(`\nIndex Statistics:`);
  console.log(`  Documents: ${indexStats.documents}`);
  console.log(`  Sessions: ${indexStats.sessions}`);
  console.log(`  Projects: ${indexStats.projects}`);
  console.log(`  Vocabulary: ${indexStats.vocabulary} terms`);

  // Synthesize learnings from knowledge store
  const knowledgeStore = new KnowledgeStore();
  knowledgeStore.load();

  if (knowledgeStore.getEntryCount() > 0) {
    console.log("\nSynthesizing learnings...");
    const newLearnings = synthesizeLearnings(knowledgeStore);
    if (newLearnings.length > 0) {
      knowledgeStore.save();
      console.log(`  Created ${newLearnings.length} new learning(s)`);

      // Write learnings to each project's MEMORY.md
      for (const projectDir of projects) {
        const projectLearnings = knowledgeStore.getGlobalLearnings(projectDir);
        if (projectLearnings.length > 0) {
          writeLearningsToMemory(projectDir, projectLearnings);
        }
      }
      console.log(`  Updated MEMORY.md for ${projects.size} project(s)`);
    } else {
      console.log("  No new learnings to synthesize");
    }
  }

  console.log("\nDone! Index saved to ~/.claude-history-mcp/");
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
