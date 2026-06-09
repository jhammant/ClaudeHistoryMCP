import { describe, it, expect } from "vitest";
import { parseSessionUserPrompts } from "../../src/parsers/transcript-history.js";

describe("parseSessionUserPrompts", () => {
  it("parses genuine string and array user prompts, picks up cwd, skips noise", () => {
    const lines = [
      // string-content user prompt + carries cwd
      JSON.stringify({
        type: "user",
        cwd: "/Users/jon/dev/myapp",
        timestamp: "2026-01-01T10:00:00.000Z",
        message: { role: "user", content: "fix the build error" },
      }),
      // array-content user prompt with a text block
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:05:00.000Z",
        message: {
          role: "user",
          content: [
            { type: "text", text: "add a new feature" },
            { type: "image", source: {} },
          ],
        },
      }),
      // tool-result user turn -> SKIPPED
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T10:06:00.000Z",
        toolUseResult: { stdout: "ok" },
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "ok" }],
        },
      }),
      // meta turn -> SKIPPED
      JSON.stringify({
        type: "user",
        isMeta: true,
        timestamp: "2026-01-01T10:07:00.000Z",
        message: { role: "user", content: "<meta>caveat</meta>" },
      }),
      // assistant line -> IGNORED
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-01-01T10:08:00.000Z",
        message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      }),
    ].join("\n");

    const entries = parseSessionUserPrompts(lines, "sess-1", "/fallback/path");

    expect(entries).toHaveLength(2);

    expect(entries[0].display).toBe("fix the build error");
    expect(entries[1].display).toBe("add a new feature");

    // cwd from the transcript is used as project for ALL entries of the session
    expect(entries[0].project).toBe("/Users/jon/dev/myapp");
    expect(entries[1].project).toBe("/Users/jon/dev/myapp");

    expect(entries[0].sessionId).toBe("sess-1");
    expect(entries[1].sessionId).toBe("sess-1");

    // ISO timestamps are converted to ms epoch
    expect(entries[0].timestamp).toBe(
      new Date("2026-01-01T10:00:00.000Z").getTime()
    );
    expect(entries[1].timestamp).toBe(
      new Date("2026-01-01T10:05:00.000Z").getTime()
    );
  });

  it("falls back to the provided project when no cwd is present", () => {
    const lines = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-02-02T12:00:00.000Z",
        message: { role: "user", content: "hello there" },
      }),
    ].join("\n");

    const entries = parseSessionUserPrompts(lines, "sess-2", "/decoded/dir");

    expect(entries).toHaveLength(1);
    expect(entries[0].project).toBe("/decoded/dir");
    expect(entries[0].display).toBe("hello there");
  });

  it("skips empty / non-text-only turns and strips system reminders", () => {
    const lines = [
      // empty after stripping the system reminder -> SKIPPED
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-03T09:00:00.000Z",
        message: {
          role: "user",
          content: "<system-reminder>just a reminder</system-reminder>",
        },
      }),
      // image-only array turn -> SKIPPED (no text blocks)
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-03T09:01:00.000Z",
        message: { role: "user", content: [{ type: "image", source: {} }] },
      }),
      // genuine prompt with an embedded reminder that gets stripped
      JSON.stringify({
        type: "user",
        timestamp: "2026-03-03T09:02:00.000Z",
        message: {
          role: "user",
          content: "real question <system-reminder>noise</system-reminder>",
        },
      }),
    ].join("\n");

    const entries = parseSessionUserPrompts(lines, "sess-3", "/fb");

    expect(entries).toHaveLength(1);
    expect(entries[0].display).toBe("real question");
  });

  it("skips Claude Code injected non-prompt user turns by leading tag", () => {
    const lines = [
      // injected task-notification (string content) -> SKIPPED
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-04T08:00:00.000Z",
        message: {
          role: "user",
          content: "<task-notification>background task done</task-notification>",
        },
      }),
      // injected ide_opened_file (string content) -> SKIPPED
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-04T08:01:00.000Z",
        message: {
          role: "user",
          content: "<ide_opened_file>/Users/jon/dev/app.ts</ide_opened_file>",
        },
      }),
      // genuine prompt in the same content -> KEPT
      JSON.stringify({
        type: "user",
        timestamp: "2026-04-04T08:02:00.000Z",
        message: { role: "user", content: "what does this function do?" },
      }),
    ].join("\n");

    const entries = parseSessionUserPrompts(lines, "sess-4", "/fb");

    expect(entries).toHaveLength(1);
    expect(entries[0].display).toBe("what does this function do?");
  });
});
