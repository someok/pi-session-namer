import test from "node:test";
import assert from "node:assert/strict";
import { formatDate, parseModelResult, resolveTimeZone } from "../src/index.js";

test("formats dates in the requested timezone", () => {
  assert.equal(formatDate("2026-03-11T00:30:00.000Z", "America/Los_Angeles"), "0310");
  assert.equal(formatDate("2026-03-11T00:30:00.000Z", "Asia/Shanghai"), "0311");
});

test("falls back for an invalid timezone", () => {
  assert.doesNotThrow(() => resolveTimeZone("Not/AZone"));
});

test("parses model control responses", () => {
  assert.equal(parseModelResult("KEEP", "0310"), "KEEP");
  assert.equal(parseModelResult("SKIP", "0310"), "SKIP");
  assert.equal(parseModelResult("修复｜OAuth 回调错误", "0310"), "0310｜修复｜OAuth 回调错误");
  assert.equal(parseModelResult("随便猜一个", "0310"), null);
});
