// AI Agents module: list, builder (System prompt · Knowledge & Memory · Output · Model · Integrations · Sub-agents) and chat.
import { $, esc, uid, debounce, field, tabBar, readBound, setPath, downloadFile, slug, pickFiles } from "./ui.js";
import { agentsStore, newAgent, connectionsStore } from "./store.js";
import { BUILTINS, TOOL_GROUPS, CATALOG, ADD_YOUR_OWN, findApp, normalizeBuiltins, matchesQuery, hasSitePermission } from "./tools.js";
import { PROVIDERS } from "./providers.js";
import {
  runAgent, promptQuality, enhancePrompt, generateAgent, summarizeToMemory,
  getActivePageText, requestSitePermission, sendWebhook
} from "./chat.js";
import { mountChat } from "./chatview.js";

const TABS = [
  ["prompt", "System prompt", "What the agent is, how it works and how it answers"],
  ["knowledge", "Knowledge & Memory", "Documents the agent answers from, and facts it remembers"],
  ["output", "Output settings", "Format, length, language and creativity"],
  ["model", "Language model", "Provider and model this agent uses"],
  ["tools", "🧰 Tools", "Built-in tools and connected apps this agent can use to take action"],
  ["subagents", "Sub-agents", "Other agents this agent consults before answering"],
  ["chat", "💬 Chat", "Talk to this agent"]
];

let ctx, root;
const view = { mode: "list", id: null, tab: "prompt", sessionId: null, search: "" };
let agents = [];
let connections = [];
let current = null;
let chatHandle = null;

const save = debounce(async () => { if (current) { await agentsStore.save(current); agents = await agentsStore.all(); } }, 400);
const saveNow = async () => { if (current) { await agentsStore.save(current); agents = await agentsStore.all(); } };
const env = () => ({ ...ctx.env(), agents });

export function initAgents(c) {
  ctx = c;
  root = $("#agentsRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
}

export async function renderAgents() {
  [agents, connections] = await Promise.all([agentsStore.all(), connectionsStore.all()]);
  chatHandle?.destroy(); chatHandle = null;
  if (view.mode === "edit") {
    current = agents.find(a => a.id === view.id) || null;
    if (!current) view.mode = "list";
  }
  root.innerHTML = view.mode === "edit" ? editorHtml() : listHtml();
  if (view.mode === "edit" && view.tab === "chat") mountAgentChat();
}

export async function openAgent(id, tab = "prompt") {
  view.mode = "edit"; view.id = id; view.tab = tab; view.sessionId = null;
  await renderAgents();
}

// Used by Workflows ("Save as agent") and Chatbots ("Create agent for this bot").
export async function createAgent(over) {
  const a = newAgent(over);
  await agentsStore.save(a);
  agents = await agentsStore.all();
  return a;
}

// ---------------- List ----------------
function listHtml() {
  const q = view.search.toLowerCase();
  const shown = agents.filter(a => !q || [a.name, a.folder, ...(a.tags || []), a.systemPrompt].join(" ").toLowerCase().includes(q));
  const groups = {};
  shown.forEach(a => (groups[a.folder || "No folder"] ||= []).push(a));
  return `
    <div class="step-head"><h2>AI Agents <span class="muted small">(${agents.length})</span></h2>
      <div class="row"><button class="btn ghost small" data-a="import" data-tip="Import an agent .json file">Import</button>
      <button class="btn primary small" data-a="new">+ New agent</button></div></div>
    <div class="card">
      <span class="badge auto">Create with AI</span>
      <textarea id="agentDesc" rows="3" placeholder="Describe the agent, e.g. 'Replies to Instagram comments in my voice and turns questions into DMs for my $5 product'"></textarea>
      <button class="btn primary block" data-a="generate">✨ Build agent with AI</button>
      <div id="agentGenStatus" class="status"></div>
    </div>
    ${agents.length ? `<input id="agentSearch" type="text" placeholder="Search agents…" value="${esc(view.search)}" />` : ""}
    ${Object.entries(groups).map(([folder, list]) => `
      <h3 class="folder">📁 ${esc(folder)}</h3>
      ${list.map(a => {
        const [q, cls] = promptQuality(a.systemPrompt);
        return `<div class="card wf-card">
          <h4>${esc(a.name)}</h4>
          <div class="meta">${(a.tags || []).map(t => `#${esc(t)}`).join(" ")} · prompt: <span class="q ${cls}">${q}</span> · ${(a.sessions || []).length} chats${a.subAgents?.length ? ` · ${a.subAgents.length} sub-agents` : ""}</div>
          <div class="agent-actions">
            <button class="btn primary small" data-a="chat" data-id="${a.id}">💬 Chat</button>
            <button class="btn ghost small" data-a="edit" data-id="${a.id}">Edit</button>
            <button class="btn ghost small" data-a="dup" data-id="${a.id}">Duplicate</button>
            <button class="btn ghost small" data-a="export" data-id="${a.id}">Export</button>
            <button class="btn danger-ghost small" data-a="del" data-id="${a.id}">Delete</button>
          </div></div>`;
      }).join("")}`).join("")}
    ${!agents.length ? `<div class="empty">No agents yet. Describe one above, or click <b>+ New agent</b>.</div>` : ""}`;
}

// ---------------- Editor ----------------
function editorHtml() {
  const a = current;
  return `
    <div class="step-head"><a href="#" class="link" data-a="back">← All agents</a>
      <div class="row">
        <button class="btn ghost small" data-a="export" data-id="${a.id}">Export</button>
        <button class="btn primary small" data-a="tab" data-tab="chat">💬 Chat</button>
      </div></div>
    <div class="card agent-head">
      <input class="title-input" type="text" data-bind="name" value="${esc(a.name)}" placeholder="Agent name" />
      <div class="grid2">
        <div>${field(a, "Folder", "folder", { placeholder: "e.g. CONTENT CREATOR", tip: "Groups agents in the list" })}</div>
        <div>${field(a, "Tags", "tags", { kind: "csv", placeholder: "comma, separated" })}</div>
      </div>
    </div>
    ${tabBar(TABS, view.tab, 'data-a="tab"')}
    <div class="tab-body">${tabHtml(view.tab)}</div>`;
}

function tabHtml(tab) {
  const a = current;
  switch (tab) {
    case "prompt": {
      const [q, cls] = promptQuality(a.systemPrompt);
      return `<div class="card">
        ${field(a, "System prompt", "systemPrompt", { type: "textarea", rows: 14, tip: "Instructions the agent always follows. Use headings and numbered steps for best results.", placeholder: "You are… Your job is to… Follow these steps: 1… 2… Output format:…" })}
        <div class="quality">System instructions quality: <span class="q ${cls}" id="pq">${q}</span></div>
        <button class="btn ghost block" data-a="enhance" data-tip="AI rewrites the prompt to be clearer and more structured. You can undo with Ctrl+Z in the box.">✨ Enhance with AI</button>
      </div>`;
    }
    case "knowledge":
      return `<div class="card">
        <h3>Knowledge</h3>
        <p class="help">The agent answers from this first. Add notes, documents or the page you are on.</p>
        ${field(a, "Notes", "knowledge.text", { type: "textarea", rows: 6, placeholder: "Paste FAQs, offers, prices, brand voice, SOPs…" })}
        <div class="agent-actions">
          <button class="btn ghost small" data-a="addfiles" data-tip="Text files: .txt .md .csv .json .html">+ Add files</button>
          <button class="btn ghost small" data-a="addpage" data-tip="Save the text of the browser tab you are on">+ Add current page</button>
        </div>
        <ul class="history">${(a.knowledge.files || []).map((f, i) => `<li><span class="grow">📄 <b>${esc(f.name)}</b> · ${f.text.length.toLocaleString()} chars</span><button class="btn ghost small" data-a="rmfile" data-i="${i}">Remove</button></li>`).join("") || `<li class="muted">No files yet.</li>`}</ul>
      </div>
      <div class="card">
        <h3>Memory</h3>
        ${field(a, "Use memory in every chat", "memory.enabled", { type: "checkbox", tip: "Remembered facts are added to every conversation with this agent." })}
        ${field(a, "Remembered facts", "memory.notes", { type: "textarea", rows: 5, placeholder: "- Pedro sells a $5 starter guide\n- Prefers short, punchy answers", help: "Add facts here, click 🧠 on any chat answer, or use 'Save chat to memory' in Chat." })}
      </div>`;
    case "output":
      return `<div class="card">
        ${field(a, "Format", "output.format", { type: "select", options: [["markdown", "Markdown (headings, lists)"], ["plain", "Plain text"], ["json", "JSON"]] })}
        ${field(a, "Length", "output.length", { type: "select", options: [["short", "Short"], ["medium", "Medium"], ["long", "Long & detailed"]] })}
        ${field(a, "Language", "output.language", { placeholder: "Same as the user (leave empty), or e.g. Portuguese", tip: "Force replies in one language" })}
        ${field(a, "Creativity", "output.creativity", { type: "select", options: [["", "Model default"], ["precise", "Precise (0.2)"], ["balanced", "Balanced (0.7)"], ["creative", "Creative (1.0)"]], tip: "Temperature. Ignored automatically by models that don't support it." })}
        ${field(a, "Extra output instructions", "output.instructions", { type: "textarea", rows: 3, placeholder: "e.g. Always end with a call to action. Use emojis sparingly." })}
      </div>`;
    case "model": {
      const s = ctx.env().settings;
      const prov = a.model.provider || "";
      const listFor = p => s.modelLists?.[p]?.map(m => m.id) || PROVIDERS[p]?.fallbackModels || [];
      const effective = prov || s.provider;
      const models = listFor(effective);
      return `<div class="card">
        ${field(a, "Provider", "model.provider", { type: "select", options: [["", `Use default (${PROVIDERS[s.provider].label})`], ...Object.entries(PROVIDERS).map(([k, p]) => [k, p.label])] })}
        ${field(a, "Model", "model.model", { type: "select", options: [["", `Use default (${s.models[effective] || "none set"})`], ...models.map(m => [m, m])] })}
        ${field(a, "…or custom model ID", "model.model", { placeholder: "e.g. a new model name", tip: "Overrides the list" })}
        <p class="help">Models come from the live list loaded in Workflows → Setup (Test key). Each agent can use a different provider – make sure that provider's key is saved in Settings.</p>
      </div>`;
    }
    case "tools": {
      a.tools ||= { builtin: [], ops: [] };
      a.tools.builtin = normalizeBuiltins(a.tools.builtin);
      const q = view.toolSearch || "";
      const on = new Set(a.tools.builtin);
      const groups = TOOL_GROUPS.map(([g, label]) => [label, BUILTINS.filter(b => b.group === g && matchesQuery(b, q))]).filter(([, list]) => list.length);
      const conns = connections.map(c => ({ c, ops: (c.operations || []).filter(op => matchesQuery({ name: `${c.name} ${op.name}`, desc: op.description, keywords: findApp(c.appId)?.keywords }, q)) })).filter(x => x.ops.length);
      const apps = q ? [...ADD_YOUR_OWN, ...CATALOG].filter(app => matchesQuery(app, q)).slice(0, 8) : [];
      const count = a.tools.builtin.length + a.tools.ops.length;
      return `<div class="card">
        <input id="toolSearch" type="text" placeholder="Search tools or what you want to do, e.g. “send email”" value="${esc(q)}" />
        <p class="help">${count} tool${count === 1 ? "" : "s"} on. The agent decides when to use them; you see live status in the chat.</p>
      </div>
      ${groups.map(([label, list]) => `<h3 class="folder">${esc(label)}</h3>
        <div class="toggle-grid">${list.map(b => `<label class="toggle-cell">
          <span class="tool-ico">${b.icon}</span><span class="grow"><b>${esc(b.name)}</b><span class="sub">${esc(b.desc)}</span></span>
          <input type="checkbox" class="switch" data-builtin="${b.id}" ${on.has(b.id) ? "checked" : ""}/></label>`).join("")}</div>`).join("")}
      <h3 class="folder">Apps and services</h3>
      <div class="card">
        ${conns.map(({ c, ops }) => `<div class="conn-block">
          <div class="conn-head"><span class="tool-ico">${esc(c.icon || "🔌")}</span><b class="grow">${esc(c.name)} <span class="muted small">${c.type === "mcp" ? "MCP" : c.type === "webhook" ? "Webhook" : "API"} · ${ops.length} tool${ops.length === 1 ? "" : "s"}</span></b>
            <label class="check small"><input type="checkbox" class="switch" data-allops="${c.id}" ${ops.every(op => a.tools.ops.includes(`${c.id}:${op.id}`)) ? "checked" : ""}/> all</label></div>
          ${ops.length <= 40 ? ops.map(op => `<label class="tool-row sub-row"><input type="checkbox" data-op="${c.id}:${op.id}" ${a.tools.ops.includes(`${c.id}:${op.id}`) ? "checked" : ""}/>
            <span class="grow"><b>${esc(op.name)}</b><span class="sub">${esc((op.description || "").slice(0, 140))}</span></span></label>`).join("")
            : `<p class="help">${ops.length} tools – search above to pick individual ones, or use “all”.</p>`}
        </div>`).join("") || `<p class="muted small">${connections.length ? "No connected tool matches." : "No apps connected yet."}</p>`}
        ${apps.length ? `<h3 class="folder">Add from apps</h3>${apps.map(app => `<div class="tool-row"><span class="tool-ico">${app.icon}</span><span class="grow"><b>${esc(app.name)}</b><span class="sub">${esc(app.desc)}</span></span><button class="btn ghost small" data-a="connect" data-app="${app.id}">Add</button></div>`).join("")}` : ""}
        <button class="btn ghost small" data-a="connect" data-tip="Browse apps, add an MCP server, a webhook / API call, or an OpenAPI spec">+ Add apps and services</button>
      </div>
      <div class="card">
        <h3>Automations</h3>
        ${field(a, "Always include the current web page", "integrations.pageContext", { type: "checkbox", tip: "Each message includes the text of the tab you're on: reply to comments, summarise posts, analyse pages." })}
        <p class="help">Chrome will ask once for permission to read pages.</p>
      </div>
      <div class="card">
        ${field(a, "Send every answer to a webhook", "integrations.webhook.enabled", { type: "checkbox", tip: "Works with Zapier, Make, n8n, Google Apps Script…" })}
        ${field(a, "Webhook URL", "integrations.webhook.url", { type: "url", placeholder: "https://hooks.zapier.com/…" })}
        <p class="help">Sends JSON: { source, agent, input, output, timestamp }. Use it to log leads in a sheet, post to Slack, etc.</p>
        <button class="btn ghost small" data-a="testhook">Send test</button>
      </div>`;
    }
    case "subagents": {
      const others = agents.filter(x => x.id !== a.id);
      return `<div class="card">
        <p class="help">Before answering, this agent asks each selected sub-agent for input and uses their answers. Great for a "team": researcher + writer + editor.</p>
        ${others.length ? others.map(o => `<label class="check"><input type="checkbox" data-sub="${o.id}" ${a.subAgents.includes(o.id) ? "checked" : ""}/> ${esc(o.name)} <span class="muted small">${esc(o.folder || "")}</span></label>`).join("")
          : `<p class="muted">Create more agents to use them as sub-agents.</p>`}
      </div>`;
    }
    case "chat": {
      const sessions = a.sessions || [];
      return `<div class="chat-toolbar row">
          <select id="sessionSel">${sessions.map(s => `<option value="${s.id}" ${s.id === view.sessionId ? "selected" : ""}>${esc(s.title || "New chat")}</option>`).join("") || `<option>New chat</option>`}</select>
          <button class="btn ghost small" data-a="newchat">+ New</button>
          <button class="btn ghost small" data-a="mem" data-tip="AI extracts key facts from this chat into the agent's memory">🧠 Save chat to memory</button>
          <button class="btn danger-ghost small" data-a="delchat" data-tip="Delete this conversation">🗑</button>
        </div>
        <div id="agentChat" class="chat-host"></div>`;
    }
  }
  return "";
}

function currentSession() {
  const a = current;
  a.sessions ||= [];
  let s = a.sessions.find(x => x.id === view.sessionId) || a.sessions[0];
  if (!s) { s = { id: uid(), title: "", messages: [], createdAt: Date.now() }; a.sessions.unshift(s); }
  view.sessionId = s.id;
  return s;
}

function mountAgentChat() {
  const a = current;
  const s = currentSession();
  chatHandle = mountChat($("#agentChat"), {
    name: a.name, avatar: "🤖", session: s,
    starters: a.starters || [],
    voice: { tts: true, stt: true },
    toast: ctx.toast,
    onPersist: () => {
      s.title ||= (s.messages.find(m => m.role === "user")?.content || "").slice(0, 50);
      a.sessions = [s, ...a.sessions.filter(x => x.id !== s.id)].slice(0, 30);
      saveNow();
      const sel = $("#sessionSel");
      if (sel && sel.selectedOptions[0]) sel.selectedOptions[0].textContent = s.title || "New chat";
    },
    onRemember: text => {
      a.memory.notes = `${(a.memory.notes || "").trim()}\n- ${text.replace(/\s+/g, " ").slice(0, 300)}`.trim();
      a.memory.enabled = true;
      saveNow(); ctx.toast("Saved to memory");
    },
    send: (messages, opts) => runAgent(a, messages, env(), opts)
  });
}

// ---------------- Events ----------------
async function onClick(e) {
  const b = e.target.closest("[data-a]");
  if (!b) return;
  e.preventDefault();
  const act = b.dataset.a;
  const id = b.dataset.id;
  const a = id ? agents.find(x => x.id === id) : current;

  if (act === "new") { const n = await createAgent({}); return openAgent(n.id); }
  if (act === "edit") return openAgent(id);
  if (act === "chat") return openAgent(id, "chat");
  if (act === "back") { await saveNow(); view.mode = "list"; return renderAgents(); }
  if (act === "tab") { view.tab = b.dataset.tab; return renderAgents(); }
  if (act === "import") return importAgents();
  if (act === "export" && a) return downloadFile(JSON.stringify({ type: "flowprint-agent", version: 1, agent: { ...a, sessions: [] } }, null, 2), `agent-${slug(a.name)}.json`);
  if (act === "dup" && a) {
    await createAgent({ ...structuredClone(a), id: uid(), name: `${a.name} (copy)`, sessions: [] });
    ctx.toast("Duplicated"); return renderAgents();
  }
  if (act === "del" && a) {
    if (!confirm(`Delete agent "${a.name}"? Chatbots using it will stop working.`)) return;
    await agentsStore.remove(a.id); ctx.toast("Deleted"); return renderAgents();
  }
  if (act === "generate") return generateFromDescription(b);
  if (act === "enhance") return enhance(b);
  if (act === "addfiles") return addFiles();
  if (act === "addpage") return addPage();
  if (act === "rmfile") { current.knowledge.files.splice(+b.dataset.i, 1); await saveNow(); return renderAgents(); }
  if (act === "testhook") return testHook();
  if (act === "connect") return ctx.openTools?.(b.dataset.app || null);
  if (act === "newchat") { const s = { id: uid(), title: "", messages: [], createdAt: Date.now() }; current.sessions.unshift(s); view.sessionId = s.id; await saveNow(); return renderAgents(); }
  if (act === "delchat") {
    if (!confirm("Delete this conversation?")) return;
    current.sessions = current.sessions.filter(s => s.id !== view.sessionId); view.sessionId = null; await saveNow(); return renderAgents();
  }
  if (act === "mem") return chatToMemory(b);
}

function onInput(e) {
  const el = e.target;
  if (el.id === "toolSearch") { view.toolSearch = el.value; const pos = el.selectionStart; renderAgents().then(() => { const s = $("#toolSearch"); s.focus(); s.setSelectionRange(pos, pos); }); return; }
  if (el.id === "agentSearch") { view.search = el.value; const pos = el.selectionStart; renderAgents().then(() => { const s = $("#agentSearch"); s.focus(); s.setSelectionRange(pos, pos); }); return; }
  if (!el.dataset.bind || !current) return;
  if (el.dataset.bind === "model.model" && el.tagName === "INPUT") {
    const sel = root.querySelector('select[data-bind="model.model"]'); if (sel) sel.value = "";
  }
  setPath(current, el.dataset.bind, readBound(el));
  if (el.dataset.bind === "systemPrompt") {
    const [q, cls] = promptQuality(current.systemPrompt);
    const pq = $("#pq"); if (pq) { pq.textContent = q; pq.className = `q ${cls}`; }
  }
  save();
}

async function onChange(e) {
  const el = e.target;
  if (el.id === "sessionSel") { view.sessionId = el.value; return renderAgents(); }
  if ((el.dataset.builtin || el.dataset.op || el.dataset.allops) && current) {
    current.tools ||= { builtin: [], ops: [] };
    if (el.dataset.builtin) {
      const b = BUILTINS.find(x => x.id === el.dataset.builtin);
      if (el.checked && b.needsSites && !(await hasSitePermission()) && !(await requestSitePermission())) {
        el.checked = false; return ctx.toast("Chrome permission is needed for this tool", true);
      }
      const set = new Set(current.tools.builtin);
      el.checked ? set.add(b.id) : set.delete(b.id);
      current.tools.builtin = [...set];
    } else {
      const refs = el.dataset.op ? [el.dataset.op] : connections.find(c => c.id === el.dataset.allops).operations.map(op => `${el.dataset.allops}:${op.id}`);
      if (el.checked) await requestSitePermission();
      const set = new Set(current.tools.ops);
      refs.forEach(r => (el.checked ? set.add(r) : set.delete(r)));
      current.tools.ops = [...set];
    }
    await saveNow();
    if (el.dataset.allops) renderAgents();
    return;
  }
  if (el.dataset.sub && current) {
    const set = new Set(current.subAgents);
    el.checked ? set.add(el.dataset.sub) : set.delete(el.dataset.sub);
    current.subAgents = [...set]; return saveNow();
  }
  if (!el.dataset.bind || !current) return;
  setPath(current, el.dataset.bind, readBound(el));
  if (el.dataset.bind === "integrations.pageContext" && el.checked) {
    const ok = await requestSitePermission();
    if (!ok) { current.integrations.pageContext = false; el.checked = false; ctx.toast("Permission needed to read pages", true); }
  }
  if (el.dataset.bind === "integrations.webhook.enabled" && el.checked) await requestSitePermission();
  await saveNow();
  if (el.dataset.bind === "model.provider") renderAgents();
}

// ---------------- Actions ----------------
async function generateFromDescription(btn) {
  const desc = $("#agentDesc").value.trim();
  const st = $("#agentGenStatus");
  if (!desc) { st.textContent = "Describe the agent first."; st.className = "status err"; return; }
  btn.disabled = true; btn.textContent = "Building…"; st.textContent = ""; st.className = "status";
  try {
    const g = await generateAgent(desc, env());
    const a = await createAgent({
      name: g.name || "New agent", folder: g.folder || "", tags: g.tags || [], systemPrompt: g.systemPrompt || "",
      output: { ...newAgent().output, ...(g.output || {}) }, starters: g.starters || []
    });
    ctx.toast("Agent created");
    openAgent(a.id);
  } catch (e) {
    st.textContent = `✗ ${e.message}`; st.className = "status err";
    btn.disabled = false; btn.textContent = "✨ Build agent with AI";
  }
}

async function enhance(btn) {
  btn.disabled = true; btn.textContent = "Enhancing…";
  try {
    const p = await enhancePrompt(current, env());
    if (p) {
      const ta = root.querySelector('[data-bind="systemPrompt"]');
      ta.focus(); ta.select();
      // execCommand keeps the browser's undo history so Ctrl+Z restores the old prompt
      if (!document.execCommand("insertText", false, p)) ta.value = p;
      current.systemPrompt = p; await saveNow(); renderAgents();
      ctx.toast("Prompt enhanced");
    }
  } catch (e) { ctx.toast(`Enhance failed: ${e.message}`, true); btn.disabled = false; btn.textContent = "✨ Enhance with AI"; }
}

async function addFiles() {
  const files = await pickFiles(".txt,.md,.csv,.json,.html,.htm,.xml,text/*");
  for (const f of files) {
    let text = await f.text();
    if (/\.html?$/i.test(f.name)) text = new DOMParser().parseFromString(text, "text/html").body.innerText;
    current.knowledge.files.push({ name: f.name, text: text.trim() });
  }
  if (files.length) { await saveNow(); renderAgents(); ctx.toast(`${files.length} file(s) added`); }
}

async function addPage() {
  try {
    if (!(await requestSitePermission())) throw new Error("Permission denied");
    const text = await getActivePageText();
    const title = (text.match(/^Title: (.*)$/m) || [])[1] || "Web page";
    current.knowledge.files.push({ name: title.slice(0, 80), text });
    await saveNow(); renderAgents(); ctx.toast("Page added to knowledge");
  } catch (e) { ctx.toast(e.message, true); }
}

async function testHook() {
  const url = current.integrations.webhook.url;
  if (!url) return ctx.toast("Enter a webhook URL first", true);
  try {
    await requestSitePermission();
    await sendWebhook(url, { source: "FlowPrint", agent: current.name, input: "Test", output: "This is a test from FlowPrint", timestamp: new Date().toISOString() });
    ctx.toast("Test sent ✓");
  } catch (e) { ctx.toast(`Webhook failed: ${e.message}`, true); }
}

async function chatToMemory(btn) {
  const s = currentSession();
  if (!s.messages.length) return ctx.toast("Chat first, then save to memory", true);
  btn.disabled = true;
  try {
    const facts = await summarizeToMemory(current, s.messages, env());
    if (facts.length) {
      current.memory.notes = `${(current.memory.notes || "").trim()}\n${facts.map(f => `- ${f}`).join("\n")}`.trim();
      current.memory.enabled = true;
      await saveNow();
    }
    ctx.toast(facts.length ? `${facts.length} facts saved to memory` : "Nothing new to remember");
  } catch (e) { ctx.toast(e.message, true); }
  btn.disabled = false;
}

async function importAgents() {
  const files = await pickFiles(".json,application/json");
  let n = 0;
  for (const f of files) {
    try {
      const d = JSON.parse(await f.text());
      const list = d.type === "flowprint-agent" ? [d.agent] : Array.isArray(d.agents) ? d.agents : [];
      for (const a of list) { await createAgent({ ...newAgent(), ...a, id: uid(), sessions: [] }); n++; }
    } catch { /* skip bad file */ }
  }
  ctx.toast(n ? `${n} agent(s) imported` : "No agents found in that file", !n);
  renderAgents();
}
