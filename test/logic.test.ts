import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationText, formatDate, parseModelResult, parseModelSegments, resolveTimeZone } from "../src/index.js";

test("formats dates in the requested timezone", () => {
  assert.equal(formatDate("2026-03-11T00:30:00.000Z", "America/Los_Angeles"), "0310");
  assert.equal(formatDate("2026-03-11T00:30:00.000Z", "Asia/Shanghai"), "0311");
});

test("buildConversationText emphasizes the newest message", () => {
  const long = "x".repeat(1200);
  const entries = [
    { type: "message", message: { role: "user", content: "old question" } },
    { type: "message", message: { role: "assistant", content: [{ type: "text", text: long }] } },
  ];
  const text = buildConversationText(entries as never);
  assert.ok(text.includes("old question"));
  // The newest (last) message keeps more than the old 700-char cap.
  assert.ok(text.length > 700 + "old question".length);
  assert.ok(text.split("x").length - 1 > 700);
});

test("falls back for an invalid timezone", () => {
  assert.doesNotThrow(() => resolveTimeZone("Not/AZone"));
});

test("parses model control responses", () => {
  assert.equal(parseModelResult("SKIP", "0310"), "SKIP");
  assert.equal(parseModelResult("", "0310"), "SKIP");
  assert.equal(parseModelResult("KEEP", "0310"), null);
  assert.equal(parseModelResult("修复｜OAuth 回调错误", "0310"), "0310｜修复｜OAuth 回调错误");
  assert.equal(parseModelResult("Research｜GitHub skills discovery｜published 0.1.1", "0310"), "0310｜Research｜GitHub skills discovery｜published 0.1.1");
  assert.equal(parseModelResult("Research｜GitHub skills discovery", "0310"), "0310｜Research｜GitHub skills discovery");
  assert.equal(parseModelResult("Research｜GitHub skills discovery｜this progress text is way longer than sixteen chars", "0310"), "0310｜Research｜GitHub skills discovery｜this progress te");
  assert.equal(parseModelResult("随便猜一个", "0310"), null);
});

test("renders custom name formats", () => {
  assert.equal(parseModelResult("Fix｜OAuth callback errors｜testing", "0310", "{type}: {topic} ({progress})"), "Fix: OAuth callback errors (testing)");
  assert.equal(parseModelResult("修复｜回调错误｜待审查", "0310", "{date}｜{type}｜{topic}"), "0310｜修复｜回调错误");
  assert.equal(parseModelResult("Fix｜Login bug", "0310", "{date}｜{type}｜{topic}"), "0310｜Fix｜Login bug");
});

test("parses model segments for diff-based change detection", () => {
  const a = parseModelSegments("Fix｜OAuth callback errors｜published 0.1.1", true);
  const b = parseModelSegments("Fix｜OAuth callback errors｜published 0.2.0", true);
  const c = parseModelSegments("Research｜GitHub skills discovery", true);
  assert.deepEqual(a, { type: "Fix", topic: "OAuth callback errors", progress: "published 0.1.1" });
  assert.deepEqual(b, { type: "Fix", topic: "OAuth callback errors", progress: "published 0.2.0" });
  assert.deepEqual(c, { type: "Research", topic: "GitHub skills discovery", progress: undefined });
  if (typeof a === "object" && typeof b === "object" && typeof c === "object") {
    assert.equal(a.type !== c.type || a.topic !== c.topic, true);
    assert.equal(a.type === b.type && a.topic === b.topic && a.progress !== b.progress, true);
  }
  assert.equal(parseModelSegments("SKIP", true), "SKIP");
  assert.equal(parseModelSegments("随便猜一个", true), null);
});
