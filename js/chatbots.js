// Chatbots module: list + 8-step builder (Brain · Identity · Chat experience · Interface · Capture · Access · Voice · Advanced) + live chat.
import { $, esc, uid, debounce, field, tabBar, readBound, setPath, downloadFile, slug, pickFiles } from "./ui.js";
import { botsStore, agentsStore, newBot } from "./store.js";
import { generateAgent } from "./chat.js";
import { mountBotChat, leadsToCsv } from "./botchat.js";
import { speak } from "./chatview.js";

const STEPS = [
  ["brain", "1 Choose the brain", "The AI agent that powers this chatbot"],
  ["identity", "2 Identity", "Name, avatar, description and greeting"],
  ["experience", "3 Chat experience", "Conversation starters, follow-up suggestions, reply style"],
  ["interface", "4 Interface", "Colours and bubble style"],
  ["capture", "5 Capture user info", "Ask for name, email etc. before chatting; see leads"],
  ["access", "6 Control access", "PIN protection and message limits"],
  ["voice", "7 Voice mode", "Speak to the bot and hear its replies"],
  ["advanced", "8 Advanced", "Memory length, creativity, fallback message"],
  ["chat", "💬 Chat", "Test the chatbot"]
];
const EMOJIS = ["🤖", "💬", "🧠", "🚀", "⭐", "🦊", "🐯", "👩‍💼", "👨‍💼", "🎯", "📈", "💡", "🛍️", "🎓", "❤️", "🔥"];

let ctx, root;
const view = { mode: "list", id: null, tab: "brain" };
let bots = [], agents = [], current = null;

const save = debounce(async () => { if (current) { await persistBot(current); } }, 400);
// Re-read before saving so conversations from the full-page chat aren't overwritten.
async function persistBot(bot, keepRemote = true) {
  const latest = keepRemote ? await botsStore.get(bot.id) : null;
  if (latest && latest !== bot) {
    const ids = new Set(bot.sessions.map(s => s.id));
    bot.sessions = [...bot.sessions, ...latest.sessions.filter(s => !ids.has(s.id))].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 50);
    const lids = new Set(bot.leads.map(l => l.id));
    bot.leads = [...bot.leads, ...latest.leads.filter(l => !lids.has(l.id))].sort((a, b) => b.ts - a.ts);
  }
  await botsStore.save(bot);
  bots = await botsStore.all();
}

export function initChatbots(c) {
  ctx = c;
  root = $("#botsRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => { if (view.mode === "edit" && view.tab === "voice") renderChatbots(); };
}

export async function renderChatbots() {
  [bots, agents] = await Promise.all([botsStore.all(), agentsStore.all()]);
  if (view.mode === "edit") {
    current = bots.find(b => b.id === view.id) || null;
    if (!current) view.mode = "list";
  }
  root.innerHTML = view.mode === "edit" ? editorHtml() : listHtml();
  if (view.mode === "edit" && view.tab === "chat") {
    mountBotChat($("#botChat"), {
      bot: current, agents, settings: ctx.env().settings, keys: ctx.env().keys, toast: ctx.toast, preview: true,
      newSession: view.freshChat, persist: b => persistBot(b)
    });
    view.freshChat = false;
  }
}

const fullPageUrl = id => (typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(`chat.html?bot=${id}`) : `chat.html?bot=${id}`);
function openFullPage(id) {
  const url = fullPageUrl(id);
  if (typeof chrome !== "undefined" && chrome.tabs?.create) chrome.tabs.create({ url }); else window.open(url, "_blank");
}

// ---------------- List ----------------
function listHtml() {
  return `
    <div class="step-head"><h2>Chatbots <span class="muted small">(${bots.length})</span></h2>
      <div class="row"><button class="btn ghost small" data-b="import">Import</button>
      <button class="btn primary small" data-b="new">+ New chatbot</button></div></div>
    ${!agents.length ? `<div class="banner warn">A chatbot needs an AI agent as its brain. You can create one inside the chatbot builder (step 1).</div>` : ""}
    ${bots.map(b => {
      const brain = agents.find(a => a.id === b.brainAgentId);
      return `<div class="card wf-card">
        <h4><span class="bot-avatar" style="background:${esc(b.ui.accent)}">${esc(b.identity.avatar)}</span>${esc(b.identity.name)}</h4>
        <div class="meta">Brain: ${brain ? esc(brain.name) : '<span class="q err">none</span>'} · ${b.sessions.length} conversations · ${b.leads.length} leads${b.access.pin ? " · 🔒 PIN" : ""}</div>
        <div class="agent-actions">
          <button class="btn primary small" data-b="chat" data-id="${b.id}">💬 Chat</button>
          <button class="btn ghost small" data-b="full" data-id="${b.id}" data-tip="Open as a full-page chatbot in a new tab">⤢ Full page</button>
          <button class="btn ghost small" data-b="edit" data-id="${b.id}">Edit</button>
          <button class="btn ghost small" data-b="dup" data-id="${b.id}">Duplicate</button>
          <button class="btn ghost small" data-b="export" data-id="${b.id}">Export</button>
          <button class="btn danger-ghost small" data-b="del" data-id="${b.id}">Delete</button>
        </div></div>`;
    }).join("") || `<div class="empty">No chatbots yet. Click <b>+ New chatbot</b>.</div>`}`;
}

// ---------------- Builder ----------------
function editorHtml() {
  const b = current;
  const idx = STEPS.findIndex(s => s[0] === view.tab);
  const prev = STEPS[idx - 1], next = STEPS[idx + 1];
  return `
    <div class="step-head"><a href="#" class="link" data-b="back">← All chatbots</a>
      <div class="row"><button class="btn ghost small" data-b="full" data-id="${b.id}">⤢ Full page</button>
      <button class="btn primary small" data-b="tab" data-tab="chat">💬 Chat</button></div></div>
    <h3 class="bot-title"><span class="bot-avatar" style="background:${esc(b.ui.accent)}">${esc(b.identity.avatar)}</span>${esc(b.identity.name)}</h3>
    ${tabBar(STEPS, view.tab, 'data-b="tab"')}
    <div class="tab-body">${tabHtml(view.tab)}</div>
    ${view.tab !== "chat" ? `<div class="wizard-nav row">
      <button class="btn ghost" data-b="tab" data-tab="${prev?.[0] || ""}" ${prev ? "" : "disabled"}>← Back</button>
      <span class="muted small">Saved automatically</span>
      <button class="btn primary" data-b="tab" data-tab="${next?.[0]}">${next?.[0] === "chat" ? "Test chat →" : "Next →"}</button></div>` : ""}`;
}

function tabHtml(tab) {
  const b = current;
  switch (tab) {
    case "brain":
      return `<div class="card">
        ${field(b, "Agent operating chatbot *", "brainAgentId", { type: "select", options: [["", "— Choose an agent —"], ...agents.map(a => [a.id, `🤖 ${a.name}`])], tip: "The chatbot uses this agent's prompt, knowledge, memory, model, integrations and sub-agents." })}
        ${b.brainAgentId ? `<button class="btn ghost small" data-b="editbrain">Edit this agent</button>` : ""}
      </div>
      <div class="card">
        <span class="badge auto">Or create a new brain with AI</span>
        <textarea id="brainDesc" rows="3" placeholder="What should this chatbot do? e.g. 'Answer questions about my coaching program and book discovery calls'"></textarea>
        <button class="btn primary block" data-b="genbrain">✨ Create agent for this chatbot</button>
      </div>`;
    case "identity":
      return `<div class="card">
        ${field(b, "Chatbot name", "identity.name")}
        <label>Avatar</label>
        <div class="pills">${EMOJIS.map(e => `<button class="pill ${b.identity.avatar === e ? "active" : ""}" data-b="emoji" data-e="${e}">${e}</button>`).join("")}</div>
        ${field(b, "…or any emoji / short text", "identity.avatar")}
        ${field(b, "Description", "identity.description", { type: "textarea", rows: 3, placeholder: "e.g. Pedro's friendly assistant for the AI Mastery Bootcamp", tip: "Tells the bot who it is and shows on the full-page header" })}
        ${field(b, "Greeting message", "identity.greeting", { type: "textarea", rows: 2 })}
      </div>`;
    case "experience":
      return `<div class="card">
        ${field(b, "Conversation starters (one per line)", "experience.starters", { type: "textarea", kind: "lines", rows: 4, placeholder: "How do I get started?\nWhat does it cost?\nCan I see an example?", tip: "Clickable suggestions shown before the first message" })}
        ${field(b, "Suggest follow-up questions after each reply", "experience.followUps", { type: "checkbox" })}
        ${field(b, "Reply style", "experience.style", { type: "textarea", rows: 2, placeholder: "Friendly, short sentences, 1–2 emojis, always end with a question" })}
        ${field(b, "Max words per reply", "experience.maxWords", { type: "number", min: 0, placeholder: "No limit" })}
      </div>`;
    case "interface":
      return `<div class="card">
        ${field(b, "Accent colour", "ui.accent", { type: "color" })}
        ${field(b, "Bubble style", "ui.bubble", { type: "select", options: [["rounded", "Rounded"], ["square", "Square"]] })}
        ${field(b, "Show avatar next to replies", "ui.showAvatar", { type: "checkbox" })}
        <label>Preview</label>
        <div class="chat ${b.ui.bubble === "square" ? "square" : ""} preview" style="--chat-accent:${esc(b.ui.accent)}"><div class="chat-log">
          <div class="msg bot">${b.ui.showAvatar !== false ? `<div class="avatar">${esc(b.identity.avatar)}</div>` : ""}<div class="bubble">${esc(b.identity.greeting)}</div></div>
          <div class="msg user"><div class="bubble">How do I get started?</div></div></div></div>
      </div>`;
    case "capture":
      return `<div class="card">
        ${field(b, "Ask for visitor details before the chat", "capture.enabled", { type: "checkbox", tip: "Collected details are saved as leads and given to the bot so it can personalise replies." })}
        ${field(b, "Intro text", "capture.intro")}
        <label>Fields</label>
        ${(b.capture.fields || []).map((f, i) => `<div class="row cap-row">
          <input type="text" data-cap="${i}" data-k="label" value="${esc(f.label)}" placeholder="Label" />
          <select data-cap="${i}" data-k="type">${["text", "email", "tel", "url", "number"].map(t => `<option ${t === f.type ? "selected" : ""}>${t}</option>`).join("")}</select>
          <label class="check"><input type="checkbox" data-cap="${i}" data-k="required" ${f.required ? "checked" : ""}/> req.</label>
          <button class="icon-btn" data-b="rmcap" data-i="${i}">✕</button></div>`).join("")}
        <button class="btn ghost small" data-b="addcap">+ Add field</button>
      </div>
      <div class="card">
        <div class="step-head"><h3>Leads (${b.leads.length})</h3>
          <div class="row"><button class="btn ghost small" data-b="csv" ${b.leads.length ? "" : "disabled"}>Export CSV</button>
          <button class="btn danger-ghost small" data-b="clearleads" ${b.leads.length ? "" : "disabled"}>Clear</button></div></div>
        <div class="table-wrap"><table><tbody>${b.leads.slice(0, 50).map(l => `<tr><td class="muted">${new Date(l.ts).toLocaleString()}</td>${Object.values(l.values).map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("") || `<tr><td class="muted">No leads yet.</td></tr>`}</tbody></table></div>
      </div>`;
    case "access":
      return `<div class="card">
        ${field(b, "Access PIN", "access.pin", { placeholder: "Leave empty for no PIN", tip: "Visitors opening the full-page chatbot must enter this PIN" })}
        ${field(b, "Message limit per conversation", "access.messageLimit", { type: "number", min: 0, placeholder: "Unlimited", tip: "Protects your API credits" })}
        ${field(b, "Message when the limit is reached", "access.limitMessage")}
      </div>`;
    case "voice": {
      const voices = "speechSynthesis" in window ? speechSynthesis.getVoices() : [];
      return `<div class="card">
        ${field(b, "Voice input (microphone button)", "voice.stt", { type: "checkbox", tip: "Uses Chrome's speech recognition. Chrome asks for microphone access the first time." })}
        ${field(b, "Read replies aloud (🔊 button)", "voice.tts", { type: "checkbox" })}
        ${field(b, "Speak every reply automatically", "voice.autoSpeak", { type: "checkbox" })}
        ${field(b, "Voice", "voice.voiceName", { type: "select", options: [["", "Browser default"], ...voices.map(v => [v.name, `${v.name} (${v.lang})`])] })}
        ${field(b, "Speed", "voice.rate", { type: "range", min: 0.5, max: 2, step: 0.1 })}
        ${field(b, "Language code", "voice.lang", { placeholder: "e.g. en-US, pt-PT (empty = browser language)" })}
        <button class="btn ghost small" data-b="testvoice">🔊 Test voice</button>
      </div>`;
    }
    case "advanced":
      return `<div class="card">
        ${field(b, "Conversation memory (turns)", "advanced.historyTurns", { type: "number", min: 1, max: 100, tip: "How many back-and-forth turns the bot remembers within a chat" })}
        ${field(b, "Creativity", "advanced.temperature", { type: "select", options: [["", "Use the agent's setting"], ["precise", "Precise"], ["balanced", "Balanced"], ["creative", "Creative"]] })}
        ${field(b, "Fallback message", "advanced.fallback", { tip: "Shown when the AI call fails" })}
        ${field(b, "Extra instructions for this chatbot", "advanced.extraInstructions", { type: "textarea", rows: 4, placeholder: "Added on top of the brain agent's prompt, e.g. 'Always offer the free guide link: https://…'" })}
      </div>
      <div class="card"><div class="step-head"><h3>Conversations (${b.sessions.length})</h3>
        <button class="btn danger-ghost small" data-b="clearconvos" ${b.sessions.length ? "" : "disabled"}>Clear all</button></div>
        <ul class="history">${b.sessions.slice(0, 20).map(s => `<li><span class="grow">${new Date(s.createdAt).toLocaleString()} · ${esc(s.title || "(no messages)")}</span><span class="muted small">${s.messages.length} msgs</span></li>`).join("") || `<li class="muted">None yet.</li>`}</ul>
      </div>`;
    case "chat":
      return `<div class="chat-toolbar row">
          <span class="muted small grow">${current.brainAgentId ? "Testing as a visitor (PIN skipped)." : "⚠ Choose a brain agent in step 1 first."}</span>
          <button class="btn ghost small" data-b="newconvo">+ New conversation</button>
        </div>
        <div id="botChat" class="chat-host"></div>`;
  }
  return "";
}

// ---------------- Events ----------------
async function onClick(e) {
  const el = e.target.closest("[data-b]");
  if (!el) return;
  e.preventDefault();
  const act = el.dataset.b;
  const b = el.dataset.id ? bots.find(x => x.id === el.dataset.id) : current;

  if (act === "new") {
    const n = newBot({ brainAgentId: agents[0]?.id || "" });
    await botsStore.save(n);
    view.mode = "edit"; view.id = n.id; view.tab = "brain";
    return renderChatbots();
  }
  if (act === "edit") { view.mode = "edit"; view.id = b.id; view.tab = "brain"; return renderChatbots(); }
  if (act === "chat") { view.mode = "edit"; view.id = b.id; view.tab = "chat"; return renderChatbots(); }
  if (act === "full") return openFullPage(b.id);
  if (act === "back") { view.mode = "list"; return renderChatbots(); }
  if (act === "tab") { if (el.dataset.tab) { view.tab = el.dataset.tab; renderChatbots(); root.closest("main")?.scrollTo(0, 0); } return; }
  if (act === "dup") { await botsStore.save({ ...structuredClone(b), id: uid(), identity: { ...b.identity, name: `${b.identity.name} (copy)` }, sessions: [], leads: [] }); ctx.toast("Duplicated"); return renderChatbots(); }
  if (act === "export") return downloadFile(JSON.stringify({ type: "flowprint-chatbot", version: 1, chatbot: { ...b, sessions: [], leads: [] }, agent: agents.find(a => a.id === b.brainAgentId) || null }, null, 2), `chatbot-${slug(b.identity.name)}.json`);
  if (act === "import") return importBots();
  if (act === "del") {
    if (!confirm(`Delete chatbot "${b.identity.name}" with its conversations and leads?`)) return;
    await botsStore.remove(b.id); ctx.toast("Deleted"); return renderChatbots();
  }
  if (act === "emoji") { current.identity.avatar = el.dataset.e; await persistBot(current); return renderChatbots(); }
  if (act === "editbrain") return ctx.openAgent(current.brainAgentId);
  if (act === "genbrain") return genBrain(el);
  if (act === "addcap") { current.capture.fields.push({ label: "New field", type: "text", required: false }); await persistBot(current); return renderChatbots(); }
  if (act === "rmcap") { current.capture.fields.splice(+el.dataset.i, 1); await persistBot(current); return renderChatbots(); }
  if (act === "csv") return downloadFile(leadsToCsv(current), `leads-${slug(current.identity.name)}.csv`, "text/csv");
  if (act === "clearleads") { if (confirm("Delete all leads?")) { current.leads = []; await persistBot(current, false); renderChatbots(); } return; }
  if (act === "clearconvos") { if (confirm("Delete all conversations?")) { current.sessions = []; await persistBot(current, false); renderChatbots(); } return; }
  if (act === "testvoice") return speak(current.identity.greeting || "Hello! This is how I sound.", current.voice);
  if (act === "newconvo") { view.freshChat = true; return renderChatbots(); }
}

function onInput(e) {
  const el = e.target;
  if (!current) return;
  if (el.dataset.cap) { current.capture.fields[+el.dataset.cap][el.dataset.k] = el.type === "checkbox" ? el.checked : el.value; return save(); }
  if (!el.dataset.bind) return;
  setPath(current, el.dataset.bind, readBound(el));
  save();
}

async function onChange(e) {
  const el = e.target;
  if (!current || (!el.dataset.bind && !el.dataset.cap)) return;
  onInput(e);
  await persistBot(current);
  if (["ui.accent", "ui.bubble", "ui.showAvatar", "identity.avatar", "brainAgentId"].includes(el.dataset.bind)) renderChatbots();
}

async function genBrain(btn) {
  const desc = $("#brainDesc").value.trim();
  if (!desc) return ctx.toast("Describe what the chatbot should do", true);
  btn.disabled = true; btn.textContent = "Creating agent…";
  try {
    const env = ctx.env();
    const g = await generateAgent(desc, { ...env, agents });
    const a = await ctx.createAgent({ name: g.name || "Chatbot brain", folder: g.folder || "CHATBOTS", tags: g.tags || [], systemPrompt: g.systemPrompt || "", starters: g.starters || [] });
    current.brainAgentId = a.id;
    if (current.identity.name === "New chatbot" && g.name) current.identity.name = g.name;
    if (!current.experience.starters.length && g.starters?.length) current.experience.starters = g.starters;
    await persistBot(current);
    ctx.toast("Brain agent created");
    renderChatbots();
  } catch (err) { ctx.toast(err.message, true); btn.disabled = false; btn.textContent = "✨ Create agent for this chatbot"; }
}

async function importBots() {
  const files = await pickFiles(".json,application/json");
  let n = 0;
  for (const f of files) {
    try {
      const d = JSON.parse(await f.text());
      if (d.type !== "flowprint-chatbot") continue;
      const bot = { ...newBot(), ...d.chatbot, id: uid(), sessions: [], leads: [] };
      if (d.agent) { const a = await ctx.createAgent({ ...d.agent, id: uid(), sessions: [] }); bot.brainAgentId = a.id; }
      await botsStore.save(bot); n++;
    } catch { /* skip */ }
  }
  ctx.toast(n ? `${n} chatbot(s) imported` : "No chatbots found in that file", !n);
  renderChatbots();
}
