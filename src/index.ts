import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const ENTRY_TYPE = "pi-session-namer";
export const DEFAULT_TYPES = ["Feature", "Design", "Fix", "Optimization", "Release", "Exploration", "Documentation", "Research"] as const;
export const DEFAULT_CONFIG = {
  model: "inherit",
  thinkingLevel: "inherit",
  timeZone: "auto",
  checkEveryTurns: 4,
  nameFormat: "{date}｜{type}｜{topic}｜{progress}",
  types: [...DEFAULT_TYPES],
  nameLanguage: "auto",
} as const;
export const PLACEHOLDERS = ["{date}", "{type}", "{topic}", "{progress}"] as const;
export type ThinkingLevel = "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type Config = {
  model: string;
  thinkingLevel: ThinkingLevel;
  timeZone: string;
  checkEveryTurns: number;
  nameFormat: string;
  types: string[];
  nameLanguage: string;
};
export type NameHistory = { name: string; source: "auto" | "manual"; reason: string; updatedAt: string };
export type State = { version: 1; autoName?: string; manualLock: boolean; date: string; timeZone: string; turnsSinceCheck: number; history: NameHistory[] };
let configWarning: string | undefined;

type Entry = { type?: string; customType?: string; data?: unknown; timestamp?: string; summary?: string; message?: { role?: string; content?: unknown } };
const configPath = () => join(homedir(), ".pi", "agent", "session-namer.json");

export function loadConfig(path = configPath()): Config {
  let raw: Partial<Config> = {};
  try {
    if (!existsSync(path)) {
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { flag: "wx" });
    }
    raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  } catch (error) {
    configWarning = `Failed to read configuration; using defaults: ${path}`;
    raw = {};
  }
  const level = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(raw.thinkingLevel))
    ? String(raw.thinkingLevel) as ThinkingLevel : DEFAULT_CONFIG.thinkingLevel;
  const turns = typeof raw.checkEveryTurns === "number" && Number.isInteger(raw.checkEveryTurns) && raw.checkEveryTurns >= 0
    ? raw.checkEveryTurns : DEFAULT_CONFIG.checkEveryTurns;
  const nameFormat = typeof raw.nameFormat === "string" && raw.nameFormat.includes("{type}") && raw.nameFormat.includes("{topic}")
    ? raw.nameFormat : DEFAULT_CONFIG.nameFormat;
  const types = Array.isArray(raw.types) && raw.types.length > 0 && raw.types.every((t) => typeof t === "string" && t.trim())
    ? raw.types.map((t) => t.trim()) : [...DEFAULT_CONFIG.types];
  const nameLanguage = typeof raw.nameLanguage === "string" && raw.nameLanguage ? raw.nameLanguage : DEFAULT_CONFIG.nameLanguage;
  return { model: typeof raw.model === "string" && raw.model ? raw.model : DEFAULT_CONFIG.model, thinkingLevel: level, timeZone: typeof raw.timeZone === "string" && raw.timeZone ? raw.timeZone : DEFAULT_CONFIG.timeZone, checkEveryTurns: turns, nameFormat, types, nameLanguage };
}

export function resolveTimeZone(value: string): string {
  if (value === "auto") return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return value; } catch { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
}

export function formatDate(iso: string, configuredZone: string): string {
  const date = new Date(iso);
  const zone = resolveTimeZone(configuredZone);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "2-digit", day: "2-digit" }).formatToParts(date);
  return `${parts.find((p) => p.type === "month")?.value ?? ""}${parts.find((p) => p.type === "day")?.value ?? ""}`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((x): x is { type?: string; text?: string } => Boolean(x) && typeof x === "object")
    .filter((x) => x.type === "text" && typeof x.text === "string").map((x) => x.text!).join("\n");
}

export function buildConversationText(entries: Entry[], maxMessages = 12, maxChars = 5000): string {
  const output: string[] = [];
  let size = 0;
  for (const entry of entries) {
    if (output.length >= maxMessages || size >= maxChars) continue;
    if (entry.type === "compaction" && entry.summary) {
      output.push(`Summary: ${entry.summary.slice(0, 700)}`);
      size += output.at(-1)!.length;
      continue;
    }
    if (entry.type !== "message") continue;
    const role = entry.message?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = textOf(entry.message?.content).trim();
    if (!text) continue;
    const toolNames = Array.isArray(entry.message?.content)
      ? entry.message.content.filter((part): part is { type?: string; name?: string } => Boolean(part) && typeof part === "object" && (part as { type?: string }).type === "toolCall").map((part) => part.name).filter(Boolean)
      : [];
    const clipped = text.slice(0, 700);
    const toolSuffix = toolNames.length ? `\nTools: ${toolNames.join(", ")}` : "";
    const line = `${role === "user" ? "User" : "Assistant"}: ${clipped}${toolSuffix}`;
    output.push(line); size += line.length;
  }
  return output.join("\n\n").slice(0, maxChars);
}

export function renderName(nameFormat: string, parts: { date: string; type: string; topic: string; progress?: string }): string {
  return nameFormat
    .replace(/\{date\}/g, parts.date)
    .replace(/\{type\}/g, parts.type)
    .replace(/\{topic\}/g, parts.topic)
    .replace(/\{progress\}/g, parts.progress ?? "");
}

function cleanupName(name: string): string {
  return name
    .replace(/(^\s+)|(\s*[｜|]\s*)+$/g, "")
    .replace(/\s*[｜|]\s*([｜|]\s*)+/g, "｜")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseModelResult(raw: string, date: string, nameFormat: string = DEFAULT_CONFIG.nameFormat): "KEEP" | "SKIP" | string | null {
  let value = raw.trim().replace(/^```\w*\s*/i, "").replace(/```\s*$/i, "").trim();
  value = value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (/^KEEP$/i.test(value)) return "KEEP";
  if (/^SKIP$/i.test(value) || !value) return "SKIP";
  const wantsProgress = nameFormat.includes("{progress}");
  const two = value.match(/^([^｜|]{1,24})[｜|](.+)$/);
  if (two && two[1].trim()) {
    const type = two[1].trim();
    const rest = two[2].trim();
    let topic = rest;
    let progress: string | undefined;
    if (wantsProgress) {
      const progressSplit = rest.match(/^(.+?)[｜|]([^｜|]+)$/);
      if (progressSplit) {
        topic = progressSplit[1].trim().replace(/[｜|]/g, "").slice(0, 60);
        progress = progressSplit[2].trim().slice(0, 16);
      } else {
        topic = rest.replace(/[｜|]/g, "").slice(0, 60);
      }
    } else {
      const topicOnly = rest.split(/[｜|]/)[0].trim().slice(0, 60);
      topic = topicOnly;
    }
    if (!topic) return null;
    return cleanupName(renderName(nameFormat, { date, type, topic, progress })) || null;
  }
  return null;
}

function latestState(ctx: ExtensionContext): State | undefined {
  const entries = ctx.sessionManager.getEntries() as Entry[];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === "custom" && entry.customType === ENTRY_TYPE && entry.data && typeof entry.data === "object") return entry.data as State;
  }
  return undefined;
}

function appendState(pi: ExtensionAPI, state: State) { pi.appendEntry(ENTRY_TYPE, state); }

function defaultState(ctx: ExtensionContext, config: Config): State {
  const header = ctx.sessionManager.getHeader();
  const zone = resolveTimeZone(config.timeZone);
  const timestamp = header?.timestamp ?? new Date().toISOString();
  return { version: 1, manualLock: false, date: formatDate(timestamp, zone), timeZone: zone, turnsSinceCheck: 0, history: [] };
}

function modelFor(ctx: ExtensionContext, config: Config): { model: typeof ctx.model; fellBack: boolean } {
  if (config.model !== "inherit") {
    const slash = config.model.indexOf("/");
    if (slash > 0) {
      const configured = ctx.modelRegistry.find(config.model.slice(0, slash), config.model.slice(slash + 1));
      if (configured && ctx.modelRegistry.hasConfiguredAuth(configured)) return { model: configured, fellBack: false };
    }
    return { model: ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model) ? ctx.model : undefined, fellBack: true };
  }
  return { model: ctx.model && ctx.modelRegistry.hasConfiguredAuth(ctx.model) ? ctx.model : undefined, fellBack: false };
}

function promptFor(state: State, currentName: string | undefined, conversation: string, config: Config): string {
  const wantsProgress = config.nameFormat.includes("{progress}");
  const languageRule = config.nameLanguage === "auto"
    ? "Use the primary language of the conversation for the type, topic, and progress."
    : `Write the type, topic, and progress in this language: ${config.nameLanguage}.`;
  const outputRule = wantsProgress
    ? '- Output only KEEP, SKIP, "Type｜Topic", or "Type｜Topic｜Progress".'
    : '- Output only KEEP, SKIP, or "Type｜Topic".';
  const progressRules = wantsProgress
    ? `\n- Progress is a short status of where the task currently stands, at most 16 characters (e.g. "published 0.1.1", "implementation done", "待审查").\n- Progress must describe the milestone or completion status of the main task, NOT the topic most recently discussed.\n- When the main task is unchanged but progress advanced, keep the type and topic identical and output the same name with only the progress updated.\n- Omit the progress only when you genuinely cannot determine it.`
    : "";
  return `You are Pi's session naming assistant. Determine what this session is currently working on.\n\nRules:\n${outputRule}\n- Choose one type from: ${config.types.join(", ")}, or use an equivalent label in the naming language.\n- Keep the topic concise, specific, and suitable for a sidebar.\n${languageRule}\n- Do not repeat the project name or include project/file paths.\n- Output a new name only when the main task has substantially changed or the progress needs updating; output KEEP when nothing substantial changed.${progressRules}\n- Output SKIP when the conversation is too short or has no clear task.\n- Do not output a date, explanation, quotes, or Markdown.\n- The program will apply the date and the name format: ${config.nameFormat}.\n\nCurrent name: ${currentName ?? state.autoName ?? "(unnamed)"}\n\n<conversation>\n${conversation}\n</conversation>`;
}

function thinkingOptions(model: { api: string; reasoning: boolean; thinkingLevelMap?: Partial<Record<string, string | null>> }, level: ThinkingLevel): Record<string, unknown> {
  if (!model.reasoning || level === "inherit" || level === "off") return {};
  const levels: ThinkingLevel[] = ["max", "xhigh", "high", "medium", "low", "minimal"];
  const start = Math.max(0, levels.indexOf(level));
  let mapped: string | undefined;
  for (let index = start; index < levels.length; index++) {
    const candidate = levels[index];
    const value = model.thinkingLevelMap?.[candidate];
    if (value !== null) { mapped = value ?? candidate; break; }
  }
  if (!mapped) return {};
  if (model.api === "anthropic-messages") return { thinkingEnabled: true, effort: mapped };
  if (["openai-completions", "openai-responses", "azure-openai-responses", "openai-codex-responses"].includes(model.api)) return { reasoningEffort: mapped };
  return {};
}

async function generate(pi: ExtensionAPI, ctx: ExtensionContext, config: Config, state: State): Promise<"KEEP" | "SKIP" | string | null> {
  const selection = modelFor(ctx, config);
  const model = selection.model;
  if (!model) return null;
  const conversation = buildConversationText(ctx.sessionManager.getBranch() as Entry[]);
  if (!conversation) return "SKIP";
  const configuredLevel = config.thinkingLevel === "inherit" ? (ctx.thinkingLevel ?? "off") : config.thinkingLevel;
  const options = { sessionId: uuidv7(), cacheRetention: "none" as const, ...thinkingOptions(model, configuredLevel) };
  const currentName = pi.getSessionName();
  const response = await ctx.modelRegistry.complete(model, { messages: [{ role: "user", content: [{ type: "text", text: promptFor(state, currentName, conversation, config) }], timestamp: Date.now() }] }, options as never);
  const text = response.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
  return parseModelResult(text, state.date, config.nameFormat);
}

export default function sessionNamer(pi: ExtensionAPI) {
  const config = loadConfig();
  let state: State | undefined;
  let running = false;
  let compactPending = false;
  let internalNameChange = false;
  let attempts = 0;
  let turns = 0;

  const notify = (ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") => { if (ctx.hasUI) ctx.ui.notify(message, level); };
  const ensureState = (ctx: ExtensionContext) => { state ??= latestState(ctx) ?? defaultState(ctx, config); return state; };
  const persist = (next: State) => { state = next; appendState(pi, next); };

  const run = async (ctx: ExtensionContext, reason: string, manual = false) => {
    const current = ensureState(ctx);
    if (!manual && !ctx.sessionManager.getSessionFile()) return;
    if (config.model !== "inherit") {
      const selection = modelFor(ctx, config);
      if (selection.fellBack && selection.model) notify(ctx, `Configured naming model is unavailable; falling back to the primary agent: ${ctx.model?.provider ?? "unknown"}/${ctx.model?.id ?? "unknown"}`, "warning");
    }
    if (running || current.manualLock || (!manual && attempts >= 3)) {
      if (manual && current.manualLock) notify(ctx, "The session name is locked. Run /session-name-unlock first.", "warning");
      return;
    }
    running = true;
    if (!manual) attempts++;
    try {
      const result = await generate(pi, ctx, config, current);
      const next = { ...current, turnsSinceCheck: 0, history: [...current.history] };
      if (result && result !== "KEEP" && result !== "SKIP") {
        internalNameChange = true;
        pi.setSessionName(result);
        next.autoName = result;
        next.history.push({ name: result, source: "auto", reason, updatedAt: new Date().toISOString() });
        next.history = next.history.slice(-5);
        attempts = 0;
        turns = 0;
        persist(next);
        if (manual || !current.autoName) notify(ctx, `Session name updated: ${result}`);
      } else {
        if (result === "KEEP" || result === "SKIP") attempts = 0;
        turns = 0;
        const actualName = pi.getSessionName();
        if (actualName && result === "KEEP") next.autoName = actualName;
        persist(next);
        if (manual) notify(ctx, result === "KEEP" ? "The current session name is still accurate; no changes made." : result === "SKIP" ? "Not enough context to update the session name." : "No valid session name was generated.", result === "KEEP" ? "info" : "warning");
      }
    } catch (error) { if (manual) notify(ctx, `Session naming failed: ${error instanceof Error ? error.message : String(error)}`, "error"); }
    finally { running = false; }
  };

  pi.on("session_start", (_event, ctx) => {
    state = latestState(ctx);
    turns = state?.turnsSinceCheck ?? 0;
    if (configWarning) {
      notify(ctx, configWarning, "warning");
      configWarning = undefined;
    }
    const currentName = pi.getSessionName();
    if (state && currentName && state.autoName && currentName !== state.autoName && !state.manualLock) {
      const history: NameHistory[] = [...state.history, { name: currentName, source: "manual", reason: "manual", updatedAt: new Date().toISOString() }];
      persist({ ...state, manualLock: true, history: history.slice(-5) });
    }
  });
  pi.on("session_compact", () => { compactPending = true; });
  pi.on("session_info_changed", (event, ctx) => {
    if (internalNameChange) { internalNameChange = false; return; }
    const current = ensureState(ctx);
    if (event.name && event.name !== current.autoName) {
      const history: NameHistory[] = [...current.history, { name: event.name, source: "manual", reason: "manual", updatedAt: new Date().toISOString() }];
      persist({ ...current, manualLock: true, history: history.slice(-5) });
    }
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const current = ensureState(ctx);
    if (current.manualLock) return;
    turns++;
    const isCompact = compactPending;
    if (isCompact || !current.autoName || (config.checkEveryTurns > 0 && turns >= config.checkEveryTurns)) {
      compactPending = false;
      await run(ctx, isCompact ? "compact" : current.autoName ? "periodic" : "initial");
    } else persist({ ...current, turnsSinceCheck: turns });
  });

  pi.registerCommand("session-name-refresh", { description: "Refresh the session name from the current conversation", handler: async (_args, ctx) => {
    notify(ctx, "Analyzing the current session to refresh its name…", "info");
    await run(ctx, "refresh", true);
  } });
  pi.registerCommand("session-name-lock", { description: "Lock the current session name", handler: async (_args, ctx) => {
    const current = ensureState(ctx);
    if (!pi.getSessionName()) return notify(ctx, "There is no session name to lock.", "warning");
    persist({ ...current, manualLock: true });
    notify(ctx, "Session name locked.", "info");
  } });
  pi.registerCommand("session-name-unlock", { description: "Unlock automatic session naming", handler: async (_args, ctx) => {
    const current = ensureState(ctx);
    if (!current.manualLock) return notify(ctx, "The session name is not locked.", "info");
    persist({ ...current, manualLock: false });
    notify(ctx, "Session name unlocked. Run /session-name-refresh when you want to update it.", "info");
  } });
  pi.registerCommand("session-name-status", { description: "Show the session naming status", handler: async (_args, ctx) => { const current = ensureState(ctx); const next = config.checkEveryTurns === 0 ? "disabled" : `in ${Math.max(0, config.checkEveryTurns - turns)} settled run(s)`; notify(ctx, `Current name: ${pi.getSessionName() ?? "(unnamed)"}\nStatus: ${current.manualLock ? "locked" : "automatic"}\nNext check: ${next}`, "info"); } });
}
