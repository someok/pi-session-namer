import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const ENTRY_TYPE = "pi-session-namer";
export const DEFAULT_CONFIG = {
  model: "inherit",
  thinkingLevel: "inherit",
  timeZone: "auto",
  checkEveryTurns: 4,
} as const;
export const TYPES = ["功能", "设计", "修复", "优化", "发布", "探索", "文档", "研究"] as const;
export type ThinkingLevel = "inherit" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type Config = { model: string; thinkingLevel: ThinkingLevel; timeZone: string; checkEveryTurns: number };
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
    configWarning = `配置文件读取失败，将使用默认配置：${path}`;
    raw = {};
  }
  const level = ["inherit", "off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(String(raw.thinkingLevel))
    ? String(raw.thinkingLevel) as ThinkingLevel : DEFAULT_CONFIG.thinkingLevel;
  const turns = typeof raw.checkEveryTurns === "number" && Number.isInteger(raw.checkEveryTurns) && raw.checkEveryTurns >= 0
    ? raw.checkEveryTurns : DEFAULT_CONFIG.checkEveryTurns;
  return { model: typeof raw.model === "string" && raw.model ? raw.model : DEFAULT_CONFIG.model, thinkingLevel: level, timeZone: typeof raw.timeZone === "string" && raw.timeZone ? raw.timeZone : DEFAULT_CONFIG.timeZone, checkEveryTurns: turns };
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

export function parseModelResult(raw: string, date: string): "KEEP" | "SKIP" | string | null {
  let value = raw.trim().replace(/^```\w*\s*/i, "").replace(/```\s*$/i, "").trim();
  value = value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  if (/^KEEP$/i.test(value)) return "KEEP";
  if (/^SKIP$/i.test(value) || !value) return "SKIP";
  const match = value.match(/^([^｜|]{1,4})[｜|](.+)$/);
  if (!match || !(TYPES as readonly string[]).includes(match[1])) return null;
  const subject = match[2].trim().replace(/[｜|]/g, "").slice(0, 20);
  return subject ? `${date}｜${match[1]}｜${subject}` : null;
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

function promptFor(state: State, currentName: string | undefined, conversation: string): string {
  return `你是 Pi 会话命名助手。请判断当前会话正在做什么。\n\n规则：\n- 只输出 KEEP、SKIP 或“类型｜主题”。\n- 类型必须是：${TYPES.join("、")}。\n- 主题简洁具体，适合侧栏，不超过 20 个字。\n- 只有主要任务明显变化时才输出新名称；同一任务的普通进展输出 KEEP。\n- 内容不足或无法判断时输出 SKIP。\n- 不要输出项目路径、文件路径、解释或 Markdown。\n- 当前会话日期由程序固定为 ${state.date}，不要输出日期。\n\n当前名称：${currentName ?? state.autoName ?? "（未命名）"}\n\n<conversation>\n${conversation}\n</conversation>`;
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
  const response = await ctx.modelRegistry.complete(model, { messages: [{ role: "user", content: [{ type: "text", text: promptFor(state, currentName, conversation) }], timestamp: Date.now() }] }, options as never);
  const text = response.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
  return parseModelResult(text, state.date);
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
      if (selection.fellBack && selection.model) notify(ctx, `配置的命名模型不可用，已回退到主 agent：${ctx.model?.provider ?? "unknown"}/${ctx.model?.id ?? "unknown"}`, "warning");
    }
    if (running || current.manualLock || (!manual && attempts >= 3)) {
      if (manual && current.manualLock) notify(ctx, "当前会话名称已锁定，请先执行 /session-name-unlock。", "warning");
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
        if (manual || !current.autoName) notify(ctx, `会话名称已更新：${result}`);
      } else {
        if (result === "KEEP" || result === "SKIP") attempts = 0;
        turns = 0;
        const actualName = pi.getSessionName();
        if (actualName && result === "KEEP") next.autoName = actualName;
        persist(next);
        if (manual) notify(ctx, result === "KEEP" ? "当前会话名称仍然准确，未修改。" : result === "SKIP" ? "当前内容不足，未更新会话名称。" : "未能生成有效的会话名称。", result === "KEEP" ? "info" : "warning");
      }
    } catch (error) { if (manual) notify(ctx, `会话命名失败：${error instanceof Error ? error.message : String(error)}`, "error"); }
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

  pi.registerCommand("session-name-refresh", { description: "根据当前对话立即刷新 session 名称", handler: async (_args, ctx) => {
    notify(ctx, "正在分析当前会话，准备刷新名称……", "info");
    await run(ctx, "refresh", true);
  } });
  pi.registerCommand("session-name-lock", { description: "锁定当前 session 名称", handler: async (_args, ctx) => {
    const current = ensureState(ctx);
    if (!pi.getSessionName()) return notify(ctx, "当前没有会话名称，无法锁定。", "warning");
    persist({ ...current, manualLock: true });
    notify(ctx, "会话名称已锁定。", "info");
  } });
  pi.registerCommand("session-name-unlock", { description: "解除 session 名称锁定", handler: async (_args, ctx) => {
    const current = ensureState(ctx);
    if (!current.manualLock) return notify(ctx, "当前会话名称未锁定。", "info");
    persist({ ...current, manualLock: false });
    notify(ctx, "会话名称已解锁。需要更新名称时，请执行 /session-name-refresh。", "info");
  } });
  pi.registerCommand("session-name-status", { description: "查看 session 命名状态", handler: async (_args, ctx) => { const current = ensureState(ctx); const next = config.checkEveryTurns === 0 ? "已关闭" : `${Math.max(0, config.checkEveryTurns - turns)} 轮后`; notify(ctx, `当前名称：${pi.getSessionName() ?? "未命名"}\n状态：${current.manualLock ? "已锁定" : "自动管理"}\n下次检查：${next}`, "info"); } });
}
