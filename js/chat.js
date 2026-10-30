// Engine for running agents and chatbots: builds the system prompt from all agent settings,
// consults sub-agents, reads the current page, and posts to webhooks.
import { chat, complete, chatWithTools } from "./providers.js";
import { buildToolset, logToolCall } from "./tools.js";
import { connectionsStore, agentsStore } from "./store.js";
import { extractJson } from "./engine.js";

const KNOWLEDGE_LIMIT = 120000; // characters of knowledge sent with each call
const PAGE_LIMIT = 20000;

const LENGTH_RULES = {
  short: "Keep answers short: 1–3 sentences or a few bullet points.",
  medium: "Keep answers medium length: clear and complete without padding.",
  long: "Give long, detailed, thorough answers."
};
const FORMAT_RULES = {
  markdown: "Format answers in clean Markdown (headings, bullet lists, bold where useful).",
  plain: "Answer in plain text only. No Markdown symbols.",
  json: "Answer ONLY with valid JSON. No prose outside the JSON."
};
export const CREATIVITY = { "": null, precise: 0.2, balanced: 0.7, creative: 1.0 };

export function resolveModel(agent, settings, keys) {
  const provider = agent?.model?.provider || settings.provider;
  const model = agent?.model?.model || settings.models[provider];
  return { provider, model, key: keys[provider] };
}

export function buildAgentSystem(agent) {
  const parts = [agent.systemPrompt?.trim() || `You are ${agent.name}, a helpful AI assistant.`];
  const o = agent.output || {};
  const rules = [FORMAT_RULES[o.format], LENGTH_RULES[o.length], o.language && `Always reply in ${o.language}.`, o.instructions]
    .filter(Boolean);
  if (rules.length) parts.push(`## Output rules\n${rules.map(r => `- ${r}`).join("\n")}`);
  const k = [agent.knowledge?.text?.trim(), ...(agent.knowledge?.files || []).map(f => `### ${f.name}\n${f.text}`)]
    .filter(Boolean).join("\n\n");
  if (k) parts.push(`## Knowledge base\nUse this information as your primary source. If the answer is not here, say so or use general knowledge carefully.\n\n${k.slice(0, KNOWLEDGE_LIMIT)}`);
  if (agent.memory?.enabled && agent.memory.notes?.trim()) {
    parts.push(`## Memory (facts remembered from earlier conversations)\n${agent.memory.notes.trim()}`);
  }
  return parts.join("\n\n");
}

// Text of the active browser tab (needs the optional "all sites" permission).
export async function getActivePageText() {
  if (typeof chrome === "undefined" || !chrome.scripting) throw new Error("Page reading only works inside the Chrome extension.");
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({ title: document.title, url: location.href, text: document.body?.innerText || "" })
  });
  const r = res?.result || {};
  return `Title: ${r.title}\nURL: ${r.url}\n\n${(r.text || "").slice(0, PAGE_LIMIT)}`;
}

export async function requestSitePermission() {
  if (typeof chrome === "undefined" || !chrome.permissions) return true;
  const perm = { origins: ["<all_urls>"] };
  if (await chrome.permissions.contains(perm)) return true;
  return chrome.permissions.request(perm);
}

export async function sendWebhook(url, payload) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Webhook returned ${res.status}`);
}

/**
 * Run an agent on a conversation.
 * env: { settings, keys, agents (all agents, for sub-agent lookup) }
 * opts: { extraSystem, historyTurns, temperature, signal, onStage(text) }
 */
export async function runAgent(agent, messages, env, opts = {}) {
  const { extraSystem = "", historyTurns = 30, signal, onStage = () => {}, onTool = () => {}, onAttachment = () => {}, onPlan = () => {}, files = [], depth = 0 } = opts;
  const { provider, model, key } = resolveModel(agent, env.settings, env.keys);
  let system = buildAgentSystem(agent);
  const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";

  if (agent.integrations?.pageContext) {
    onStage("Reading the current page…");
    try { system += `\n\n## Current web page (the user is looking at this)\n${await getActivePageText()}`; }
    catch (e) { system += `\n\n(Note: the current page could not be read: ${e.message})`; }
  }

  const subs = depth === 0 ? (agent.subAgents || []).map(id => env.agents.find(a => a.id === id)).filter(Boolean) : [];
  for (const sub of subs) {
    onStage(`Consulting ${sub.name}…`);
    try {
      const recent = messages.slice(-6);
      const ans = await runAgent(sub, recent, env, { signal, depth: 1, historyTurns: 6 });
      system += `\n\n## Input from your sub-agent "${sub.name}"\nUse this when it helps your answer:\n${ans}`;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      system += `\n\n(Sub-agent "${sub.name}" failed: ${e.message})`;
    }
  }

  if (extraSystem) system += `\n\n${extraSystem}`;
  onStage("Thinking…");
  const temperature = opts.temperature ?? CREATIVITY[agent.output?.creativity || ""] ?? null;
  const history = messages.slice(-historyTurns * 2);
  const tools = buildToolset(agent, env.connections || (await connectionsStore.all()));
  let text;
  if (tools.length) {
    system += `\n\n## Tools\nYou can call tools when they help (${tools.map(t => t.name).join(", ")}). Use them for anything you cannot answer reliably on your own, then answer the user using the results.`;
    const byName = Object.fromEntries(tools.map(t => [t.name, t]));
    const execute = async (name, args) => {
      const t = byName[name];
      if (!t) throw new Error(`Unknown tool "${name}"`);
      const id = Math.random().toString(36).slice(2);
      const label = safeLabel(t, args);
      onTool({ id, icon: t.icon, label, status: "running" });
      const started = Date.now();
      try {
        const out = await t.run(args, {
          env, signal, agent, files, plan: onPlan,
          saveAgent: env.saveAgent || (a => agentsStore.save(a)),
          attach: a => onAttachment(a)
        });
        onTool({ id, icon: t.icon, label, status: "done" });
        logToolCall({ ref: t.ref, tool: t.name, agent: agent.name, agentId: agent.id, ok: true, ms: Date.now() - started });
        return out;
      } catch (e) {
        if (e.name === "AbortError") throw e;
        onTool({ id, icon: t.icon, label, status: "error", detail: e.message });
        logToolCall({ ref: t.ref, tool: t.name, agent: agent.name, agentId: agent.id, ok: false, ms: Date.now() - started, error: e.message });
        throw e;
      }
    };
    text = await chatWithTools({
      provider, key, model, system, messages: history, tools, execute,
      maxTokens: env.settings.maxTokens, temperature, signal
    });
  } else {
    text = await chat({
      provider, key, model, system, messages: history,
      maxTokens: env.settings.maxTokens, json: agent.output?.format === "json", temperature, signal
    });
  }

  if (depth === 0 && agent.integrations?.webhook?.enabled && agent.integrations.webhook.url) {
    sendWebhook(agent.integrations.webhook.url, {
      source: "FlowPrint", agent: agent.name, input: lastUser, output: text, timestamp: new Date().toISOString()
    }).catch(e => console.warn("Webhook failed", e));
  }
  return text;
}

function safeLabel(t, args) {
  try { return t.label?.(args || {}) || `Using ${t.name}`; } catch { return `Using ${t.name}`; }
}

// ---------- AI helpers for the builders ----------
export function promptQuality(p) {
  const t = (p || "").trim();
  const words = t ? t.split(/\s+/).length : 0;
  const structured = /(^|\n)\s*([-*•]|\d+[.)]|#)/.test(t);
  const hasFormat = /(format|output|respond|reply|structure|tone)/i.test(t);
  if (words < 25) return ["Needs work", "err"];
  if (words < 80) return ["Fair", "warn"];
  if (structured && hasFormat && words >= 150) return ["Excellent", "ok"];
  return ["Good", "ok"];
}

const ENHANCE_SYSTEM = `You are an expert prompt engineer. Rewrite the given agent system prompt so it is specific, structured and reliable:
role and goal, step-by-step instructions, constraints, tone, and exact output format. Keep the author's intent, names and any {{variables}}.
Return ONLY JSON: {"systemPrompt": "string"}`;

export async function enhancePrompt(agent, env) {
  const { provider, model, key } = resolveModel(agent, env.settings, env.keys);
  const raw = await complete({
    provider, key, model, system: ENHANCE_SYSTEM, maxTokens: 4000,
    user: `Agent name: ${agent.name}\nFolder: ${agent.folder || "-"}\n\nCurrent system prompt:\n${agent.systemPrompt || "(empty – write one from the agent name)"}`
  });
  return extractJson(raw).systemPrompt;
}

const AGENT_FROM_DESC = `You design AI agents. From the user's description return ONLY JSON:
{"name": "short agent name", "folder": "category like CONTENT CREATOR or SALES", "tags": ["tag"],
 "systemPrompt": "complete second-person system prompt (150-350 words): role, goal, step-by-step method, constraints, tone, output format",
 "output": {"format": "markdown|plain|json", "length": "short|medium|long"},
 "starters": ["3 example questions a user might ask this agent"]}`;

export async function generateAgent(description, env) {
  const { provider, model, key } = resolveModel(null, env.settings, env.keys);
  const raw = await complete({ provider, key, model, system: AGENT_FROM_DESC, user: description, maxTokens: 4000 });
  return extractJson(raw);
}

const MEMORY_SYSTEM = `Extract durable facts worth remembering about the user and their preferences/business from this conversation.
Return ONLY JSON: {"facts": ["short fact", ...]} (max 8, skip anything already in existing memory).`;

export async function summarizeToMemory(agent, messages, env) {
  const { provider, model, key } = resolveModel(agent, env.settings, env.keys);
  const convo = messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n").slice(-30000);
  const raw = await complete({
    provider, key, model, system: MEMORY_SYSTEM, maxTokens: 1500,
    user: `Existing memory:\n${agent.memory?.notes || "(none)"}\n\nConversation:\n${convo}`
  });
  return extractJson(raw).facts || [];
}
