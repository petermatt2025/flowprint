// Tools page (Assets → Tools): add your own (MCP / link / OpenAPI), workspace connections with health, apps catalogue,
// built-in tools, activity and tool settings.
import { $, esc, uid } from "./ui.js";
import { connectionsStore, agentsStore } from "./store.js";
import {
  BUILTINS, CATALOG, ADD_YOUR_OWN, findApp, matchesQuery, newConnectionFromCatalog, newMcpConnection,
  importOpenApi, runConnectionOp, getToolLog, toolName, syncMcp
} from "./tools.js";
import { requestSitePermission } from "./chat.js";

let ctx, root;
const view = { search: "", connecting: null, editing: null, parsed: null, linkMode: "webhook" };
let connections = [], agents = [], log = [];
const checking = new Set();

export function initTools(c) {
  ctx = c;
  root = $("#toolsRoot");
  root.addEventListener("click", onClick);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
}

export function openConnect(appId) {
  view.connecting = appId || null;
  view.editing = null;
  view.parsed = null;
}

export async function renderTools() {
  [connections, agents, log] = await Promise.all([connectionsStore.all(), agentsStore.all(), getToolLog()]);
  root.innerHTML = view.connecting || view.editing ? formHtml() : pageHtml();
  if (view.connecting || view.editing) root.closest("main")?.scrollTo(0, 0);
  else checkMcpHealth();
}

// Ping MCP servers in the background so "Not responding" is visible.
async function checkMcpHealth() {
  for (const c of connections.filter(x => x.type === "mcp" && !checking.has(x.id) && Date.now() - (x.lastSync || 0) > 5 * 60000)) {
    checking.add(c.id);
    syncMcp(c).then(async upd => { await connectionsStore.save(upd); checking.delete(c.id); if (!view.connecting && !view.editing && ctx.isVisible()) renderTools(); });
  }
}

// ---------------- Health ----------------
function health(c) {
  if (c.type === "mcp" && c.status === "down") return { cls: "err", text: "Not responding", detail: c.statusText };
  const refs = (c.operations || []).map(o => `${c.id}:${o.id}`);
  const calls = log.filter(l => refs.includes(l.ref));
  if (calls[0] && !calls[0].ok) return { cls: "err", text: "Last call failed", detail: calls[0].error };
  const fails = calls.slice(0, 20).filter(x => !x.ok).length;
  if (fails) return { cls: "warn", text: `${fails} recent failure${fails > 1 ? "s" : ""}` };
  return null;
}
const typeLabel = c => (c.type === "mcp" ? "MCP" : c.type === "webhook" ? "Webhook" : "API");
const usedBy = c => agents.filter(a => (a.tools?.ops || []).some(r => r.startsWith(`${c.id}:`)));

// ---------------- Main page ----------------
function pageHtml() {
  const q = view.search;
  const own = ADD_YOUR_OWN.filter(a => matchesQuery(a, q));
  const conns = connections.filter(c => matchesQuery({ name: c.name, desc: c.description, keywords: `${(c.operations || []).map(o => `${o.name} ${o.description}`).join(" ")} ${findApp(c.appId)?.keywords || ""}` }, q));
  const apps = CATALOG.filter(a => matchesQuery(a, q));
  const builtins = BUILTINS.filter(b => matchesQuery(b, q));
  const keys = ctx.env().keys, settings = ctx.env().settings;
  return `
    <div class="step-head"><h2>Apps and services</h2></div>
    <input id="toolsSearch" type="text" placeholder="Search apps or what they do, like “send email”" value="${esc(q)}" />

    ${own.length ? `<h3 class="folder">Add your own</h3>
    <div class="app-grid own">${own.map(a => `<button class="app-tile" data-t="connect" data-app="${a.id}"><span class="tool-ico big">${a.icon}</span><b>${esc(a.name)}</b><span class="sub">${esc(a.desc)}</span></button>`).join("")}</div>` : ""}

    <h3 class="folder">In your workspace <span class="count">${connections.length}</span></h3>
    ${conns.map(c => {
      const h = health(c);
      const users = usedBy(c);
      const n = (c.operations || []).length;
      return `<div class="card wf-card conn-card">
        <h4><span class="tool-ico">${esc(c.icon || "🔌")}</span><span class="grow">${esc(c.name)}</span>
          ${checking.has(c.id) ? '<span class="mini-spinner"></span>' : ""}</h4>
        <div class="meta">${typeLabel(c)} · ${h?.text === "Not responding" ? `<span class="q err">Not responding</span>` : `${n} tool${n === 1 ? "" : "s"}`}${h && h.text !== "Not responding" ? ` · <span class="q ${h.cls}">${esc(h.text)}</span>` : ""} · used by ${users.length ? users.map(a => esc(a.name)).join(", ") : "no agents"}</div>
        ${h?.detail ? `<div class="err-text small">${esc(h.detail.slice(0, 200))}</div>` : ""}
        <div class="agent-actions">
          ${c.type === "mcp" ? `<button class="btn ghost small" data-t="sync" data-id="${c.id}" data-tip="Reconnect and reload this server's tools">↻ Refresh</button>` : ""}
          ${c.type === "webhook" ? `<button class="btn ghost small" data-t="test" data-id="${c.id}">Send test</button>` : ""}
          <button class="btn ghost small" data-t="edit" data-id="${c.id}">Edit</button>
          <button class="btn danger-ghost small" data-t="del" data-id="${c.id}">Remove</button>
        </div></div>`;
    }).join("") || `<p class="muted small">${connections.length ? "Nothing in your workspace matches." : "Nothing connected yet – add your own above or pick an app below."}</p>`}

    <h3 class="folder">Apps <span class="count">${apps.length}</span></h3>
    <div class="app-grid">${apps.map(a => `<button class="app-tile" data-t="connect" data-app="${a.id}" data-tip="${esc(a.desc)}">
      <span class="tool-ico big">${a.icon}</span><b>${esc(a.name)}</b><span class="sub">${esc(a.label)}</span></button>`).join("") || `<p class="muted small">No app matches “${esc(q)}”. Try <b>Zapier</b> – it reaches 8,000+ apps.</p>`}</div>

    <h3 class="folder">Built-in tools <span class="count">${builtins.length}</span></h3>
    <div class="card">${builtins.map(b => {
      const calls = log.filter(l => l.ref === `builtin:${b.id}`);
      const n = agents.filter(a => (a.tools?.builtin || []).includes(b.id)).length;
      return `<div class="tool-row"><span class="tool-ico">${b.icon}</span><span class="grow"><b>${esc(b.name)}</b>
        <span class="sub">${esc(b.desc)} · ${n} agent${n === 1 ? "" : "s"}${calls[0] && !calls[0].ok ? ` · <span class="err-text">last call failed</span>` : ""}</span></span></div>`;
    }).join("")}<p class="help">Turn tools on per agent: AI Agents → (agent) → 🧰 Tools.</p></div>

    <h3 class="folder">Recent activity</h3>
    <div class="card"><ul class="history">${log.slice(0, 25).map(l => `<li><span class="q ${l.ok ? "ok" : "err"}">${l.ok ? "✓" : "✗"}</span>
      <span class="grow"><b>${esc(l.tool)}</b> · ${esc(l.agent || "")} · ${new Date(l.ts).toLocaleString()} · ${l.ms}ms${l.error ? `<span class="sub err-text">${esc(l.error)}</span>` : ""}</span></li>`).join("") || `<li class="muted">No tool calls yet.</li>`}</ul></div>

    <h3 class="folder">Tool settings</h3>
    <div class="card">
      <label for="tavilyKey">Tavily API key (optional) <i class="tip" data-tip="Better web search. Free tier at tavily.com. Without it, web search uses DuckDuckGo.">?</i></label>
      <input id="tavilyKey" type="password" value="${esc(keys.tavily || "")}" placeholder="tvly-…" autocomplete="off" />
      <label for="imageModel">Image model <i class="tip" data-tip="OpenAI image model used by Image generation. Needs your OpenAI key.">?</i></label>
      <input id="imageModel" type="text" value="${esc(settings.tools?.imageModel || "gpt-image-1")}" />
    </div>`;
}

// ---------------- Forms ----------------
const agentPicker = () => `<label for="giveTo">Give these tools to an agent (optional)</label>
  <select id="giveTo"><option value="">— not now —</option>${agents.map(a => `<option value="${a.id}">🤖 ${esc(a.name)}</option>`).join("")}</select>`;

const headersText = h => Object.entries(h || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
const parseHeaders = t => Object.fromEntries(t.split("\n").map(l => l.trim()).filter(l => l.includes(":")).map(l => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

function formKind(app, editing) {
  if (editing) return editing.type === "mcp" ? "mcp" : editing.appId === "custom_openapi" || editing.appId === "custom_api" ? "openapi" : editing.appId === "custom_link" ? "link" : editing.type;
  return app.kind;
}

function formHtml() {
  const editing = view.editing ? connections.find(c => c.id === view.editing) : null;
  const app = findApp(editing?.appId || view.connecting) || ADD_YOUR_OWN[0];
  const kind = formKind(app, editing);
  let body = "";

  if (kind === "zapier") {
    const zap = connections.find(c => c.appId === "zapier");
    return `<div class="step-head"><a href="#" class="link" data-t="back">← Apps and services</a></div>
      <div class="card"><h3><span class="tool-ico big">${app.icon}</span> ${esc(app.name)}</h3>
      <p>${esc(app.help)}</p>
      ${zap ? `<p class="q ok">✓ Zapier MCP is connected (${zap.operations.length} tools). Add the ${esc(app.name)} actions in mcp.zapier.com, then press Refresh on Zapier.</p>
        <button class="btn primary block" data-t="sync" data-id="${zap.id}">↻ Refresh Zapier tools</button>`
        : `<button class="btn primary block" data-t="connect" data-app="zapier">Connect Zapier MCP</button>`}
      <p class="help">Prefer a direct link? Use <a href="#" class="link" data-t="connect" data-app="custom_link">A link to call</a> with a Zapier/Make webhook.</p></div>`;
  }

  if (kind === "mcp") {
    if (app.oauth) {
      return `<div class="step-head"><a href="#" class="link" data-t="back">← Apps and services</a></div>
        <div class="card"><h3><span class="tool-ico big">${app.icon}</span> ${esc(app.name)}</h3><p>${esc(app.help)}</p>
        <button class="btn primary block" data-t="connect" data-app="zapier">Use Zapier MCP instead</button></div>`;
    }
    const creds = editing?.creds || {};
    const urlNeedsCreds = /\{\{\w+\}\}/.test(app.url || "");
    body = `
      <label for="cName">Name</label><input id="cName" type="text" value="${esc(editing?.name || (app.id === "custom_mcp" ? "" : app.name))}" placeholder="e.g. MCP CRM" />
      ${!urlNeedsCreds || editing ? `<label for="cUrl">Server URL (Streamable HTTP)</label><input id="cUrl" type="url" value="${esc(editing?.url || app.url || "")}" placeholder="https://…/mcp" />` : ""}
      ${(app.fields || []).map(f => `<label for="cr-${f.key}">${esc(f.label)}</label><input id="cr-${f.key}" data-cred="${f.key}" type="${f.secret ? "password" : "text"}" value="${esc(creds[f.key] || "")}" autocomplete="off" />`).join("")}
      <details ${app.id === "custom_mcp" ? "open" : ""}><summary>Extra headers (optional)</summary>
        <textarea id="cHeaders" rows="3" placeholder="Authorization: Bearer …\nX-Custom: value">${esc(editing && app.id === "custom_mcp" ? headersText(editing.headers) : "")}</textarea></details>`;
  } else if (kind === "link") {
    const op = editing?.operations?.[0];
    const mode = editing ? (editing.type === "webhook" ? "webhook" : "api") : view.linkMode;
    const params = (op?.params || []).filter(p => p.in !== "path").map(p => `${p.required ? "*" : ""}${p.name}: ${p.description || ""}`).join("\n");
    body = `
      <div class="pills"><button class="pill ${mode === "webhook" ? "active" : ""}" data-t="mode" data-mode="webhook">Webhook</button><button class="pill ${mode === "api" ? "active" : ""}" data-t="mode" data-mode="api">One API call</button></div>
      <label for="cName">Tool name</label><input id="cName" type="text" value="${esc(editing?.name || "")}" placeholder="e.g. Add lead to CRM" />
      ${mode === "api" ? `<div class="row"><select id="cMethod" style="flex:0 0 100px">${["GET", "POST", "PUT", "PATCH", "DELETE"].map(m => `<option ${op?.method === m ? "selected" : ""}>${m}</option>`).join("")}</select>
        <input id="cUrl" type="url" value="${esc(op?.path || "")}" placeholder="https://api.example.com/v1/items/{id}" /></div>
        <p class="help">Use {placeholders} in the URL for values the agent fills in.</p>
        <label for="cHeaders">Headers (one per line)</label><textarea id="cHeaders" rows="3" placeholder="Authorization: Bearer YOUR_KEY">${esc(headersText(editing?.headers))}</textarea>`
      : `<label for="cUrl">Webhook URL</label><input id="cUrl" type="url" value="${esc(editing?.url || "")}" placeholder="https://hooks.zapier.com/hooks/catch/…" />`}
      <label for="cDesc">What does it do? <i class="tip" data-tip="The agent reads this to decide when to use it – be specific.">?</i></label>
      <textarea id="cDesc" rows="2" placeholder="e.g. Saves a new lead (name, email, interest) to my CRM">${esc(editing?.description || op?.description || "")}</textarea>
      <label for="cParams">Inputs the agent sends (one per line, * = required)</label>
      <textarea id="cParams" rows="4" placeholder="*name: Lead's full name\n*email: Lead's email\ninterest: What they want">${esc(params)}</textarea>`;
  } else if (kind === "webhook") {
    const op = editing?.operations[0];
    body = `
      <label for="cName">Name</label><input id="cName" type="text" value="${esc(editing?.name || app.name)}" />
      <label for="cUrl">Webhook URL</label><input id="cUrl" type="url" value="${esc(editing?.url || "")}" placeholder="https://…" />
      <label for="cDesc">What does it do?</label><textarea id="cDesc" rows="2">${esc(editing?.description || app.desc)}</textarea>
      <label for="cParams">Inputs (one per line, * = required)</label>
      <textarea id="cParams" rows="3">${esc((op?.params || app.params || []).map(p => `${p.required ? "*" : ""}${p.name}: ${p.description || ""}`).join("\n"))}</textarea>`;
  } else if (kind === "api") {
    const creds = editing?.creds || {};
    body = `
      <label for="cName">Name</label><input id="cName" type="text" value="${esc(editing?.name || app.name)}" />
      ${(app.creds || []).map(cr => `<label for="cr-${cr.key}">${esc(cr.label)}</label><input id="cr-${cr.key}" data-cred="${cr.key}" type="${cr.secret ? "password" : "text"}" value="${esc(creds[cr.key] || "")}" autocomplete="off" />`).join("")}
      <label>Tools included</label>
      <ul class="history">${(editing?.operations || app.operations).map(o => `<li><span class="grow"><b>${esc(o.name)}</b><span class="sub">${esc(o.description)}</span></span></li>`).join("")}</ul>`;
  } else {
    const p = view.parsed || (editing ? { title: editing.name, baseUrl: editing.baseUrl, auth: editing.auth, operations: editing.operations } : null);
    body = `
      ${!editing ? `<label for="cSpec">OpenAPI / Swagger JSON, or a URL to it</label>
      <textarea id="cSpec" rows="6" placeholder='{"openapi":"3.0.0", "paths": { … } }  or  https://api.example.com/openapi.json'></textarea>
      <button class="btn ghost small" data-t="parse">Read spec</button>` : ""}
      ${p ? `<label for="cName">Name</label><input id="cName" type="text" value="${esc(p.title)}" />
        <label for="cBase">Base URL</label><input id="cBase" type="url" value="${esc(p.baseUrl)}" />
        <label for="cAuth">Authentication</label>
        <select id="cAuth">${[["none", "None"], ["bearer", "Bearer token"], ["header", "API key in header"], ["query", "API key in query string"]].map(([v, l]) => `<option value="${v}" ${p.auth?.type === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <label for="cAuthName">Header / query parameter name</label><input id="cAuthName" type="text" value="${esc(p.auth?.name || "")}" placeholder="e.g. X-API-Key" />
        <label for="cSecret">API key / token</label><input id="cSecret" type="password" value="${esc(editing?.creds?.apiKey || "")}" autocomplete="off" />
        <label>${p.operations.length} operations → ${p.operations.length} tools</label>
        <ul class="history">${p.operations.slice(0, 80).map(o => `<li><span class="grow"><b>${esc(o.method)} ${esc(o.path)}</b><span class="sub">${esc(o.description)}</span></span></li>`).join("")}</ul>` : ""}`;
  }

  return `
    <div class="step-head"><a href="#" class="link" data-t="back">← Apps and services</a></div>
    <div class="card">
      <h3><span class="tool-ico big">${app.icon}</span> ${editing ? "Edit" : "Add"} ${esc(editing?.name || app.name)}</h3>
      <p class="help">${esc(app.help || "")}</p>
      ${body}
      ${!editing ? agentPicker() : ""}
      <button class="btn primary block" data-t="save">${editing ? "Save changes" : kind === "mcp" ? "Connect & load tools" : "Add"}</button>
      <div id="connStatus" class="status"></div>
    </div>`;
}

function parseParams(text, where = "body") {
  return text.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
    const required = l.startsWith("*");
    const [name, ...rest] = l.replace(/^\*/, "").split(":");
    return { name: toolName(name.trim()), description: rest.join(":").trim(), required, type: "string", in: where };
  });
}

async function saveForm(btn) {
  const st = $("#connStatus");
  const editing = view.editing ? connections.find(c => c.id === view.editing) : null;
  const app = findApp(editing?.appId || view.connecting) || ADD_YOUR_OWN[0];
  const kind = formKind(app, editing);
  const val = id => $(id)?.value.trim() || "";
  btn.disabled = true;
  st.textContent = ""; st.className = "status";
  try {
    let conn;
    if (kind === "mcp") {
      const creds = Object.fromEntries([...root.querySelectorAll("[data-cred]")].map(i => [i.dataset.cred, i.value.trim()]));
      const missing = (app.fields || []).filter(f => f.secret && !creds[f.key]);
      if (missing.length) throw new Error(`Enter: ${missing.map(m => m.label).join(", ")}`);
      const url = $("#cUrl") ? val("#cUrl") : app.url;
      if (!/^https?:\/\//i.test(url.replace(/\{\{\w+\}\}/g, "x"))) throw new Error("Enter the server URL (https://…)");
      const fresh = newMcpConnection(app, { name: val("#cName") || app.name, url, creds, extraHeaders: parseHeaders($("#cHeaders")?.value || "") });
      conn = editing ? Object.assign(editing, { name: fresh.name, url: fresh.url, headers: fresh.headers, creds }) : fresh;
      await requestSitePermission();
      st.innerHTML = '<span class="mini-spinner"></span> Connecting…';
      await syncMcp(conn);
      if (conn.status === "down") throw new Error(`Couldn't connect: ${conn.statusText}`);
    } else if (kind === "link") {
      const mode = editing ? (editing.type === "webhook" ? "webhook" : "api") : view.linkMode;
      const name = val("#cName") || "My link";
      const description = val("#cDesc") || name;
      const url = val("#cUrl");
      if (!/^https?:\/\//i.test(url)) throw new Error("Enter the URL (https://…)");
      if (mode === "webhook") {
        conn = editing || { id: uid(), appId: "custom_link", type: "webhook", icon: "🪝", createdAt: Date.now() };
        Object.assign(conn, { name, url, description, operations: [{ id: "send", name: toolName(name), description, params: parseParams(val("#cParams")) }] });
      } else {
        const method = $("#cMethod").value;
        const pathParams = [...url.matchAll(/\{(\w+)\}/g)].map(m => ({ name: m[1], in: "path", type: "string", required: true, description: "" }));
        const inputs = parseParams(val("#cParams"), ["GET", "DELETE"].includes(method) ? "query" : "body").filter(p => !pathParams.some(x => x.name === p.name));
        conn = editing || { id: uid(), appId: "custom_link", type: "api", icon: "🪝", createdAt: Date.now() };
        Object.assign(conn, { name, description, baseUrl: "", auth: { type: "none" }, headers: parseHeaders(val("#cHeaders")),
          operations: [{ id: "call", name: toolName(name), description, method, path: url, params: [...pathParams, ...inputs] }] });
      }
    } else if (kind === "webhook") {
      const url = val("#cUrl");
      if (!/^https:\/\//i.test(url)) throw new Error("Enter the webhook URL (https://…)");
      const name = val("#cName") || app.name, description = val("#cDesc") || app.desc;
      conn = editing || newConnectionFromCatalog(app, { name, url, description });
      Object.assign(conn, { name, url, description, operations: [{ id: "send", name: toolName(name), description, params: parseParams(val("#cParams")) }] });
    } else if (kind === "api") {
      const creds = Object.fromEntries([...root.querySelectorAll("[data-cred]")].map(i => [i.dataset.cred, i.value.trim()]));
      const missing = (app.creds || []).filter(c => c.secret && !creds[c.key]);
      if (missing.length) throw new Error(`Enter: ${missing.map(m => m.label).join(", ")}`);
      conn = editing || newConnectionFromCatalog(app, { name: val("#cName"), creds });
      conn.name = val("#cName") || app.name;
      conn.creds = creds;
    } else {
      const p = view.parsed || (editing && { operations: editing.operations });
      if (!p) throw new Error("Read the spec first");
      conn = editing || { id: uid(), appId: "custom_openapi", type: "api", icon: "🧩", operations: p.operations, createdAt: Date.now() };
      Object.assign(conn, { name: val("#cName") || "Custom API", baseUrl: val("#cBase"), auth: { type: $("#cAuth").value, name: val("#cAuthName"), value: "{{apiKey}}" }, creds: { apiKey: val("#cSecret") } });
      if (!conn.baseUrl) throw new Error("Enter the base URL");
    }
    await requestSitePermission();
    await connectionsStore.save(conn);
    const giveTo = $("#giveTo")?.value;
    if (giveTo) {
      const a = await agentsStore.get(giveTo);
      a.tools ||= { builtin: [], ops: [] };
      a.tools.ops = [...new Set([...a.tools.ops, ...conn.operations.map(o => `${conn.id}:${o.id}`)])];
      await agentsStore.save(a);
    }
    ctx.toast(editing ? "Saved" : `${conn.name} added · ${conn.operations.length} tool${conn.operations.length === 1 ? "" : "s"}${giveTo ? " · given to the agent" : ""}`);
    view.connecting = null; view.editing = null; view.parsed = null;
    renderTools();
  } catch (e) { st.textContent = `✗ ${e.message}`; st.className = "status err"; btn.disabled = false; }
}

async function parseSpec(btn) {
  const st = $("#connStatus");
  let raw = $("#cSpec").value.trim();
  btn.disabled = true;
  try {
    if (/^https?:\/\//i.test(raw)) {
      await requestSitePermission();
      const r = await fetch(raw);
      if (!r.ok) throw new Error(`Could not download (${r.status})`);
      raw = await r.text();
    }
    if (!raw.startsWith("{")) throw new Error("Paste the spec as JSON (YAML isn't supported yet – convert it at editor.swagger.io → File → Convert and save as JSON).");
    view.parsed = importOpenApi(raw);
    renderTools();
  } catch (e) { st.textContent = `✗ ${e.message}`; st.className = "status err"; btn.disabled = false; }
}

// ---------------- Events ----------------
async function onClick(e) {
  const b = e.target.closest("[data-t]");
  if (!b) return;
  e.preventDefault();
  const act = b.dataset.t;
  const conn = b.dataset.id && connections.find(c => c.id === b.dataset.id);
  if (act === "connect") { openConnect(b.dataset.app); return renderTools(); }
  if (act === "back") { view.connecting = null; view.editing = null; view.parsed = null; return renderTools(); }
  if (act === "mode") { view.linkMode = b.dataset.mode; return renderTools(); }
  if (act === "edit") { view.editing = conn.id; view.connecting = null; return renderTools(); }
  if (act === "save") return saveForm(b);
  if (act === "parse") return parseSpec(b);
  if (act === "sync") {
    checking.add(conn.id); renderTools();
    await requestSitePermission();
    await connectionsStore.save(await syncMcp(conn));
    checking.delete(conn.id);
    ctx.toast(conn.status === "down" ? `Not responding: ${conn.statusText}` : `${conn.operations.length} tools loaded`, conn.status === "down");
    view.connecting = null;
    return renderTools();
  }
  if (act === "del") {
    if (!confirm(`Remove ${conn.name}? Agents using it will lose these tools.`)) return;
    await connectionsStore.remove(conn.id);
    for (const a of agents.filter(x => x.tools?.ops?.some(r => r.startsWith(`${conn.id}:`)))) {
      a.tools.ops = a.tools.ops.filter(r => !r.startsWith(`${conn.id}:`));
      await agentsStore.save(a);
    }
    ctx.toast("Removed"); return renderTools();
  }
  if (act === "test") {
    b.disabled = true;
    try { await requestSitePermission(); await runConnectionOp(conn, conn.operations[0], { message: "Test from FlowPrint" }); ctx.toast("Test sent ✓"); }
    catch (err) { ctx.toast(`Test failed: ${err.message}`, true); }
    b.disabled = false;
  }
}

let searchTimer;
function onInput(e) {
  const el = e.target;
  if (el.id !== "toolsSearch") return;
  view.search = el.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const pos = el.selectionStart;
    renderTools().then(() => { const s = $("#toolsSearch"); s?.focus(); s?.setSelectionRange(pos, pos); });
  }, 200);
}

async function onChange(e) {
  const el = e.target;
  if (el.id === "tavilyKey") await ctx.setKey("tavily", el.value.trim());
  if (el.id === "imageModel") { const s = ctx.env().settings; s.tools = { ...(s.tools || {}), imageModel: el.value.trim() }; await ctx.saveSettings(); }
}
