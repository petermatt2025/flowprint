// Connections (MCP servers, links to call, OpenAPI specs, app templates), the apps catalogue,
// per-agent toolsets and the tool activity log.
import { local } from "./storage.js";
import { uid } from "./ui.js";
import { connectionsStore } from "./store.js";
import { fetchT, clip, toolName } from "./toolcore.js";
import { BUILTINS, TOOL_GROUPS, normalizeBuiltins } from "./builtins.js";

export { BUILTINS, TOOL_GROUPS, normalizeBuiltins, toolName };
const LOG_LIMIT = 300;

export function matchesQuery(item, q) {
  if (!q) return true;
  const hay = [item.name, item.desc, item.description, item.keywords, item.cat, item.label].join(" ").toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
}

export async function hasSitePermission() {
  if (typeof chrome === "undefined" || !chrome.permissions) return true;
  return chrome.permissions.contains({ origins: ["<all_urls>"] });
}

// ---------------- Apps catalogue ----------------
const ZAP_HELP = "Go to mcp.zapier.com → New MCP server → add the actions you want → Connect → copy the server URL.";
const mcp = (id, name, icon, desc, keywords, url, fields, help, extra = {}) => ({ id, name, icon, kind: "mcp", label: "MCP", desc, keywords, url, fields, help, ...extra });
const viaZapier = (id, name, icon, desc, keywords) => ({ id, name, icon, kind: "zapier", label: "App · via Zapier", desc, keywords, help: `Connect ${name} through Zapier MCP: in mcp.zapier.com add the ${name} actions you want, then connect Zapier here once. All its actions become tools.` });
const bearer = (key, label) => ({ key, label, secret: true, header: "Authorization", prefix: "Bearer " });

export const ADD_YOUR_OWN = [
  { id: "custom_mcp", name: "An MCP server", icon: "🔌", kind: "mcp", desc: "By its link", keywords: "mcp server model context protocol link url", help: "Paste the server's Streamable HTTP URL. Add a token or headers if it needs them.", url: "", fields: [] },
  { id: "custom_link", name: "A link to call", icon: "🪝", kind: "link", desc: "A webhook (Zapier, Make, n8n) or one API call", keywords: "webhook link url zapier make n8n api call http request", help: "Webhook: the agent POSTs JSON with the inputs you define. API call: any method/URL with {placeholders}." },
  { id: "custom_openapi", name: "An OpenAPI spec", icon: "🧩", kind: "openapi", desc: "Every operation of an API, from its spec", keywords: "openapi swagger api spec rest custom import", help: "Paste OpenAPI 3 / Swagger JSON or a URL to it." }
];

export const CATALOG = [
  mcp("apify", "Apify", "🕷", "Scrapers and automations from Apify Store", "scrape scraper crawl automation instagram tiktok google maps leads", "https://mcp.apify.com", [bearer("token", "Apify API token")], "Get your token at console.apify.com → Settings → API & Integrations."),
  mcp("dataforseo", "DataForSEO", "📈", "Search rankings, keywords and backlinks", "seo keywords rankings backlinks serp", "", [{ key: "auth", label: "Authorization header (e.g. Basic …)", secret: true, header: "Authorization" }], "Paste the DataForSEO MCP server URL from their docs and your Basic auth header (base64 of login:password)."),
  mcp("emaillistverify", "EmailListVerify", "✔️", "Check email addresses are real", "email verify validate check bounce", "", [], "Paste the EmailListVerify MCP server URL (with your API key) from your account."),
  mcp("firecrawl", "Firecrawl", "🔥", "Scrape and crawl websites", "scrape crawl website extract markdown", "https://mcp.firecrawl.dev/{{apiKey}}/v2/mcp", [{ key: "apiKey", label: "Firecrawl API key", secret: true, inUrl: true }], "Get an API key at firecrawl.dev. If the URL changes, copy it from Firecrawl's MCP docs."),
  mcp("gohighlevel", "GoHighLevel", "🟢", "Contacts, calendars and more", "crm ghl highlevel contacts calendar opportunities pipeline sms leads", "https://services.leadconnectorhq.com/mcp/", [bearer("pit", "Private Integration Token"), { key: "locationId", label: "Location (sub-account) ID", header: "locationId" }], "In GoHighLevel: Settings → Private Integrations → create a token with the scopes you need. Copy your Location ID from Settings → Business Profile."),
  mcp("make", "Make", "🟣", "Your Make scenarios", "automation scenarios make integromat", "", [], "In Make: open your organisation → MCP server (or a scenario's MCP toggle) → copy the server URL with its token."),
  mcp("notion", "Notion", "📓", "Your Notion pages, after you sign in", "notion pages docs database notes", "https://mcp.notion.com/mcp", [], "Notion's MCP server needs a sign-in (OAuth), which FlowPrint doesn't support yet. Use Zapier MCP's Notion actions instead.", { oauth: true }),
  mcp("tally", "Tally", "📝", "Build and manage your forms", "forms survey tally quiz", "", [bearer("token", "Tally API key")], "Paste Tally's MCP server URL from their docs and your API key (tally.so → Settings → API keys)."),
  mcp("zapier", "Zapier", "⚡", "Gmail, Sheets, Slack and 8,000 more apps", "zapier gmail sheets slack calendar crm send email any app automation", "", [], ZAP_HELP),
  mcp("github", "GitHub", "🐙", "Repos, issues and pull requests", "github code repo issues pull requests", "https://api.githubcopilot.com/mcp/", [bearer("token", "GitHub personal access token")], "Create a fine-grained token at github.com/settings/tokens."),
  mcp("exa", "Exa", "🔭", "AI web search and research", "search research web exa", "https://mcp.exa.ai/mcp?exaApiKey={{apiKey}}", [{ key: "apiKey", label: "Exa API key", secret: true, inUrl: true }], "Get an API key at dashboard.exa.ai."),
  {
    id: "airtable", name: "Airtable", icon: "🗃", kind: "api", label: "App", desc: "Read and create records", keywords: "database crm records table leads save list",
    help: "Create a personal access token at airtable.com/create/tokens (data.records:read/write).",
    creds: [{ key: "token", label: "Personal access token", secret: true }, { key: "baseId", label: "Base ID (app…)" }],
    baseUrl: "https://api.airtable.com/v0/{{baseId}}", auth: { type: "bearer", value: "{{token}}" },
    operations: [
      { id: "list", name: "list_records", description: "List records from a table", method: "GET", path: "/{table}",
        params: [{ name: "table", in: "path", type: "string", description: "Table name", required: true }, { name: "maxRecords", in: "query", type: "number", description: "Max records" }, { name: "filterByFormula", in: "query", type: "string", description: "Airtable formula filter" }] },
      { id: "create", name: "create_record", description: "Create a record in a table", method: "POST", path: "/{table}",
        params: [{ name: "table", in: "path", type: "string", required: true, description: "Table name" }, { name: "fields", in: "body", type: "json", required: true, description: "JSON object of field → value" }] }
    ]
  },
  {
    id: "resend", name: "Resend", icon: "📧", kind: "api", label: "App", desc: "Send emails from your domain", keywords: "send email mail transactional outreach newsletter",
    help: "Create an API key at resend.com and verify your sending domain.",
    creds: [{ key: "apiKey", label: "API key", secret: true }, { key: "from", label: "Default sender, e.g. Pedro <hi@yourdomain.com>" }],
    baseUrl: "https://api.resend.com", auth: { type: "bearer", value: "{{apiKey}}" },
    operations: [{ id: "sendEmail", name: "send_email", description: "Send an email", method: "POST", path: "/emails",
      params: [{ name: "to", in: "body", type: "string", description: "Recipient email", required: true }, { name: "subject", in: "body", type: "string", required: true },
        { name: "html", in: "body", type: "string", description: "Body (HTML allowed)", required: true }, { name: "from", in: "body", type: "string", description: "Sender (empty = default)", default: "{{from}}" }] }]
  },
  {
    id: "telegram", name: "Telegram", icon: "✈️", kind: "api", label: "App", desc: "Send messages with your bot", keywords: "telegram message send chat bot notify",
    help: "Create a bot with @BotFather and copy its token.",
    creds: [{ key: "token", label: "Bot token", secret: true }],
    baseUrl: "https://api.telegram.org/bot{{token}}", auth: { type: "none" },
    operations: [{ id: "sendMessage", name: "send_message", description: "Send a Telegram message", method: "POST", path: "/sendMessage",
      params: [{ name: "chat_id", in: "body", type: "string", description: "Chat or user id", required: true }, { name: "text", in: "body", type: "string", required: true, description: "Message" }] }]
  },
  { id: "slack", name: "Slack", icon: "💬", kind: "webhook", label: "App · webhook", desc: "Post to a channel", keywords: "slack message team notify channel", help: "Slack: create an app → Incoming Webhooks → add to a channel → copy the URL.", params: [{ name: "text", description: "Message text", required: true }] },
  { id: "discord", name: "Discord", icon: "🎮", kind: "webhook", label: "App · webhook", desc: "Post to a channel", keywords: "discord message community notify", help: "Discord: channel settings → Integrations → Webhooks → copy URL.", params: [{ name: "content", description: "Message text", required: true }] },
  { id: "sheets_webhook", name: "Google Sheets (direct)", icon: "📊", kind: "webhook", label: "App · webhook", desc: "Append rows via Apps Script", keywords: "google sheets spreadsheet crm log leads row", help: "Sheets: Extensions → Apps Script → doPost(e) that appends JSON.parse(e.postData.contents) → Deploy as web app (Anyone) → copy URL.", params: [{ name: "data", description: "JSON object of column values", required: true }] },
  { id: "n8n", name: "n8n", icon: "🔶", kind: "webhook", label: "Webhook", desc: "Trigger an n8n workflow", keywords: "n8n automation workflow webhook", help: "n8n: add a Webhook node (POST), copy the Production URL, activate the workflow.", params: [] },
  ...[
    ["apollo", "Apollo", "🚀", "Prospects and sequences", "leads prospecting sales contacts enrich"],
    ["calendly", "Calendly", "📅", "Scheduling links and events", "booking calendar meetings schedule"],
    ["canva", "Canva", "🎨", "Designs and brand templates", "design graphics templates"],
    ["clickup", "ClickUp", "✅", "Tasks and projects", "tasks project management todo"],
    ["dropbox", "Dropbox", "📦", "Files and folders", "files storage upload"],
    ["elevenlabs", "ElevenLabs", "🎙", "Voices and speech", "voice text to speech audio"],
    ["excel", "Excel", "📗", "Workbooks and rows", "spreadsheet microsoft rows"],
    ["facebook", "Facebook", "📘", "Pages and posts", "facebook page post social meta"],
    ["fathom", "Fathom", "🎥", "Meeting notes and recordings", "meetings notes transcripts calls"],
    ["gamma", "Gamma", "✨", "Presentations and docs", "presentation slides docs"],
    ["gmail", "Gmail", "✉️", "Send and read email", "send email gmail mail inbox reply"],
    ["google_analytics", "Google Analytics", "📉", "Traffic and reports", "analytics traffic reports"],
    ["google_calendar", "Google Calendar", "🗓", "Events and availability", "calendar events booking meetings"],
    ["google_docs", "Google Docs", "📄", "Create and edit docs", "docs documents write"],
    ["google_drive", "Google Drive", "🗂", "Files and folders", "drive files upload storage"],
    ["google_sheets", "Google Sheets", "📊", "Rows and spreadsheets", "sheets spreadsheet rows crm log"],
    ["gumroad", "Gumroad", "💵", "Products and sales", "sales products digital store"],
    ["heygen", "HeyGen", "🧑‍💻", "AI avatar videos", "video avatar ai"],
    ["hubspot", "HubSpot", "🧲", "CRM contacts and deals", "crm contacts deals pipeline email"],
    ["instagram", "Instagram", "📸", "Posts, comments and DMs", "instagram post comments social dm"],
    ["instantly", "Instantly", "📨", "Cold email campaigns", "cold email outreach campaigns leads"],
    ["kit", "Kit", "💌", "Subscribers and broadcasts", "convertkit email newsletter subscribers"],
    ["linkedin", "LinkedIn", "💼", "Posts and profile", "linkedin post social b2b"],
    ["mem0", "Mem0", "🧠", "Long-term AI memory", "memory remember"],
    ["meta_ads", "Meta Ads", "📣", "Campaigns and ad insights", "ads facebook instagram campaigns"],
    ["monday", "Monday", "🗂", "Boards and items", "project tasks boards"],
    ["notion_app", "Notion", "📓", "Pages and databases", "notion pages database notes"],
    ["onedrive", "OneDrive", "☁️", "Files and folders", "files microsoft storage"],
    ["outlook", "Outlook", "📮", "Email and calendar", "send email outlook microsoft calendar"],
    ["reddit", "Reddit", "👽", "Posts and comments", "reddit post community social"],
    ["shopify", "Shopify", "🛍", "Products, orders and customers", "store ecommerce orders products"],
    ["twitter", "X (Twitter)", "🐦", "Posts and replies", "twitter x tweet post social"],
    ["youtube", "YouTube", "▶️", "Videos and channel", "youtube video channel"]
  ].map(a => viaZapier(...a))
];

export const findApp = id => [...ADD_YOUR_OWN, ...CATALOG].find(a => a.id === id);

// ---------------- Connection factories ----------------
const fill = (tpl, creds) => String(tpl ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => creds?.[k] ?? "");

export function newMcpConnection(app, { name, url, creds = {}, extraHeaders = {} }) {
  const headers = { ...extraHeaders };
  (app.fields || []).forEach(f => { if (f.header && creds[f.key]) headers[f.header] = `${f.prefix || ""}${creds[f.key]}`; });
  return { id: uid(), appId: app.id, type: "mcp", name: name || app.name, icon: app.icon, url: fill(url || app.url, creds), headers, creds, operations: [], createdAt: Date.now() };
}

export function newConnectionFromCatalog(app, values) {
  const base = { id: uid(), appId: app.id, name: values.name || app.name, icon: app.icon, createdAt: Date.now() };
  if (app.kind === "webhook") {
    return { ...base, type: "webhook", url: values.url, description: values.description || app.desc,
      operations: [{ id: "send", name: toolName(values.name || app.name), description: values.description || app.desc, params: values.params?.length ? values.params : app.params }] };
  }
  return { ...base, type: "api", creds: values.creds || {}, baseUrl: app.baseUrl, auth: app.auth, headers: app.headers || {}, operations: structuredClone(app.operations) };
}

// ---------------- Schemas ----------------
// Reduce any JSON schema to the subset every provider accepts.
export function cleanSchema(s, depth = 0) {
  if (!s || typeof s !== "object" || depth > 8) return { type: "string" };
  if (s.anyOf || s.oneOf) {
    const opt = (s.anyOf || s.oneOf).find(x => x && x.type !== "null") || {};
    return cleanSchema({ ...opt, description: s.description || opt.description }, depth + 1);
  }
  let type = Array.isArray(s.type) ? s.type.find(t => t !== "null") : s.type;
  if (!type) type = s.properties ? "object" : s.items ? "array" : "string";
  const out = { type };
  if (s.description) out.description = String(s.description).slice(0, 600);
  if (Array.isArray(s.enum) && type === "string") out.enum = s.enum.filter(v => v !== null).map(String);
  if (type === "object") {
    out.properties = {};
    Object.entries(s.properties || {}).forEach(([k, v]) => { out.properties[k] = cleanSchema(v, depth + 1); });
    const req = (s.required || []).filter(k => k in out.properties);
    if (req.length) out.required = req;
  }
  if (type === "array") out.items = cleanSchema(s.items || { type: "string" }, depth + 1);
  return out;
}

const paramSchema = p => {
  const t = p.type === "number" || p.type === "integer" ? "number" : p.type === "boolean" ? "boolean" : "string";
  const desc = [p.description, p.type === "json" && "(JSON text)"].filter(Boolean).join(" ");
  return { type: t, ...(desc ? { description: desc } : {}), ...(Array.isArray(p.enum) && t === "string" ? { enum: p.enum.map(String) } : {}) };
};

export function opSchema(op) {
  if (op.inputSchema) return cleanSchema({ type: "object", ...op.inputSchema });
  const props = {}, required = [];
  (op.params || []).forEach(p => { props[p.name] = paramSchema(p); if (p.required) required.push(p.name); });
  if (!op.params?.length && op.id === "send") props.message = { type: "string", description: "Data to send" };
  return { type: "object", properties: props, required };
}

// ---------------- Webhook / API calls ----------------
function parseJsonArgs(op, args) {
  const out = { ...args };
  (op.params || []).forEach(p => {
    if ((p.type === "json" || p.name === "data") && typeof out[p.name] === "string") {
      try { out[p.name] = JSON.parse(out[p.name]); } catch { /* keep text */ }
    }
  });
  return out;
}

export async function runConnectionOp(conn, op, args, ctx = {}) {
  const signal = ctx.signal;
  if (conn.type === "mcp") return mcpCallTool(conn, op.name, args, ctx);
  if (conn.type === "webhook") {
    const r = await fetchT(conn.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "FlowPrint", ...parseJsonArgs(op, args) }) }, signal);
    const t = await r.text();
    if (!r.ok) throw new Error(`Webhook returned ${r.status}: ${t.slice(0, 200)}`);
    return clip(t || "OK – delivered.");
  }
  const creds = conn.creds || {};
  const a = parseJsonArgs(op, args);
  let path = op.path || "/";
  const query = new URLSearchParams();
  const body = {};
  const headers = { Accept: "application/json", ...Object.fromEntries(Object.entries(conn.headers || {}).map(([k, v]) => [k, fill(v, creds)])) };
  (op.params || []).forEach(p => {
    let v = a[p.name];
    if ((v === undefined || v === "") && p.default !== undefined) v = fill(p.default, creds);
    if (v === undefined || v === "") return;
    if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v));
    else if (p.in === "query") query.set(p.name, typeof v === "object" ? JSON.stringify(v) : v);
    else if (p.in === "header") headers[p.name] = String(v);
    else body[p.name] = v;
  });
  const auth = conn.auth || { type: "none" };
  const secret = fill(auth.value, creds);
  if (auth.type === "bearer" && secret) headers.Authorization = `Bearer ${secret}`;
  if (auth.type === "header" && auth.name) headers[auth.name] = secret;
  if (auth.type === "query" && auth.name) query.set(auth.name, secret);
  const base = fill(conn.baseUrl, creds).replace(/\/$/, "");
  const url = `${base}${path}${query.toString() ? `${path.includes("?") ? "&" : "?"}${query}` : ""}`;
  const method = (op.method || "GET").toUpperCase();
  const hasBody = !["GET", "HEAD"].includes(method) && Object.keys(body).length;
  if (hasBody) headers["content-type"] = "application/json";
  const r = await fetchT(url, { method, headers, ...(hasBody ? { body: JSON.stringify(body) } : {}) }, signal);
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} → ${r.status}: ${t.slice(0, 300)}`);
  return clip(t || `OK (${r.status})`);
}

// ---------------- MCP client (Streamable HTTP) ----------------
const mcpSessions = new Map();
let rpcId = 0;
const PROTOCOL = "2025-06-18";

async function readRpc(r, id) {
  const type = r.headers.get("content-type") || "";
  if (!type.includes("text/event-stream")) {
    const j = await r.json();
    return Array.isArray(j) ? j.find(m => m.id === id) : j;
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, "\n");
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const event = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = event.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try {
        const msg = JSON.parse(data);
        if (msg.id === id) { reader.cancel().catch(() => {}); return msg; }
      } catch { /* not JSON */ }
    }
    if (done) throw new Error("MCP server closed the stream without a reply");
  }
}

async function mcpPost(conn, payload, signal, sess) {
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", ...(conn.headers || {}) };
  if (sess?.sessionId) headers["mcp-session-id"] = sess.sessionId;
  if (sess?.protocol) headers["mcp-protocol-version"] = sess.protocol;
  return fetchT(conn.url, { method: "POST", headers, body: JSON.stringify(payload) }, signal, 60000);
}

async function mcpInit(conn, signal) {
  const id = ++rpcId;
  const r = await mcpPost(conn, { jsonrpc: "2.0", id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "FlowPrint", version: "0.4" } } }, signal);
  if (!r.ok) throw new Error(`MCP server returned ${r.status}${r.status === 401 || r.status === 403 ? " (check the token / URL)" : ""}: ${(await r.text()).slice(0, 200)}`);
  const msg = await readRpc(r, id);
  if (msg?.error) throw new Error(msg.error.message || "MCP initialize failed");
  const sess = { sessionId: r.headers.get("mcp-session-id"), protocol: msg?.result?.protocolVersion || PROTOCOL, server: msg?.result?.serverInfo };
  await mcpPost(conn, { jsonrpc: "2.0", method: "notifications/initialized" }, signal, sess).catch(() => {});
  mcpSessions.set(conn.id, sess);
  return sess;
}

async function mcpRpc(conn, method, params, signal, retried = false) {
  const sess = mcpSessions.get(conn.id) || await mcpInit(conn, signal);
  const id = ++rpcId;
  const r = await mcpPost(conn, { jsonrpc: "2.0", id, method, params }, signal, sess);
  if ((r.status === 404 || r.status === 400) && sess.sessionId && !retried) {
    mcpSessions.delete(conn.id);
    return mcpRpc(conn, method, params, signal, true);
  }
  if (!r.ok) throw new Error(`MCP ${method} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const msg = await readRpc(r, id);
  if (msg?.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
  return msg?.result;
}

export async function mcpListTools(conn, signal) {
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page++) {
    const res = await mcpRpc(conn, "tools/list", cursor ? { cursor } : {}, signal);
    tools.push(...(res?.tools || []));
    cursor = res?.nextCursor;
    if (!cursor) break;
  }
  return tools.map(t => ({ id: t.name, name: t.name, description: (t.description || t.title || t.name).slice(0, 1000), inputSchema: t.inputSchema || { type: "object", properties: {} } }));
}

async function mcpCallTool(conn, name, args, ctx) {
  const res = await mcpRpc(conn, "tools/call", { name, arguments: args || {} }, ctx.signal);
  const parts = [];
  (res?.content || []).forEach(c => {
    if (c.type === "text") parts.push(c.text);
    else if (c.type === "image" && c.data) { ctx.attach?.({ type: "image", src: `data:${c.mimeType || "image/png"};base64,${c.data}`, prompt: name }); parts.push("[image shown to the user]"); }
    else if (c.type === "resource") parts.push(c.resource?.text || c.resource?.uri || "");
    else if (c.type === "resource_link") parts.push(`${c.name || ""} ${c.uri || ""}`);
  });
  if (!parts.length && res?.structuredContent) parts.push(JSON.stringify(res.structuredContent));
  const text = clip(parts.join("\n").trim() || "(no output)");
  if (res?.isError) throw new Error(text.slice(0, 500));
  return text;
}

// Re-read a server's tools; returns the updated connection.
export async function syncMcp(conn, signal) {
  try {
    conn.operations = await mcpListTools(conn, signal);
    conn.status = "ok";
    conn.statusText = "";
  } catch (e) {
    conn.status = "down";
    conn.statusText = e.message;
    mcpSessions.delete(conn.id);
  }
  conn.lastSync = Date.now();
  return conn;
}

// ---------------- OpenAPI import ----------------
export function importOpenApi(spec) {
  if (typeof spec === "string") spec = JSON.parse(spec);
  if (!spec.paths) throw new Error("No 'paths' found – is this an OpenAPI/Swagger JSON file?");
  const resolve = (o, depth = 0) => {
    if (!o || depth > 6) return o;
    if (o.$ref) return resolve(o.$ref.replace(/^#\//, "").split("/").reduce((a, k) => a?.[k], spec), depth + 1);
    return o;
  };
  const kindOf = sc => (["number", "integer"].includes(sc?.type) ? "number" : sc?.type === "boolean" ? "boolean" : ["object", "array"].includes(sc?.type) ? "json" : "string");
  const baseUrl = spec.servers?.[0]?.url || (spec.host ? `${(spec.schemes || ["https"])[0]}://${spec.host}${spec.basePath || ""}` : "");
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const op = item[method];
      if (!op) continue;
      const all = [...(item.parameters || []), ...(op.parameters || [])].map(p => resolve(p)).filter(Boolean);
      const params = all.filter(p => p.in !== "cookie" && p.in !== "body").map(p => {
        const sc = resolve(p.schema) || p;
        return { name: p.name, in: p.in, type: kindOf(sc), description: p.description || "", required: !!p.required, enum: sc.enum };
      });
      const bodySchema = resolve(op.requestBody?.content?.["application/json"]?.schema) || resolve(all.find(p => p.in === "body")?.schema);
      if (bodySchema?.properties) {
        const req = new Set(bodySchema.required || []);
        Object.entries(bodySchema.properties).forEach(([name, raw]) => {
          const sc = resolve(raw) || {};
          params.push({ name, in: "body", type: kindOf(sc), description: sc.description || "", required: req.has(name), enum: sc.enum });
        });
      }
      const name = toolName(op.operationId || `${method}_${path}`);
      ops.push({ id: name, name, description: (op.summary || op.description || `${method.toUpperCase()} ${path}`).slice(0, 300), method: method.toUpperCase(), path, params });
    }
  }
  if (!ops.length) throw new Error("No operations found in this definition.");
  const schemes = spec.components?.securitySchemes || spec.securityDefinitions || {};
  const first = Object.values(schemes)[0];
  const auth = !first ? { type: "none" } : first.type === "http" && first.scheme === "bearer" ? { type: "bearer", value: "{{apiKey}}" }
    : first.type === "apiKey" ? { type: first.in === "query" ? "query" : "header", name: first.name, value: "{{apiKey}}" } : { type: "bearer", value: "{{apiKey}}" };
  return { title: spec.info?.title || "Custom API", description: spec.info?.description?.slice(0, 200) || "", baseUrl, auth, operations: ops };
}

// ---------------- Toolsets ----------------
// [{ name, description, schema, label(args), run(args, ctx), ref, icon }]
export function buildToolset(agent, connections, { all = false } = {}) {
  const sel = agent?.tools || { builtin: [], ops: [] };
  const set = [];
  if (!all) {
    const on = normalizeBuiltins(sel.builtin);
    BUILTINS.filter(b => on.includes(b.id)).forEach(b => b.functions.forEach(f => set.push({
      name: f.name, description: f.description, schema: f.schema, label: f.label, run: f.run, ref: `builtin:${b.id}`, icon: b.icon
    })));
  }
  const used = new Set(set.map(t => t.name));
  connections.forEach(c => {
    (c.operations || []).forEach(op => {
      const ref = `${c.id}:${op.id}`;
      if (!all && !sel.ops?.includes(ref)) return;
      let name = toolName(c.type === "webhook" || c.operations.length === 1 ? c.name : `${c.name}_${op.name}`);
      while (used.has(name)) name = toolName(`${name.slice(0, 60)}_2`);
      used.add(name);
      set.push({
        name, ref, icon: c.icon,
        description: `${c.name}: ${fill(op.description, c.creds) || op.name}`.slice(0, 1000),
        schema: opSchema(op),
        label: () => `Using ${c.name}${c.operations.length > 1 ? ` → ${op.name}` : ""}`,
        run: (args, ctx) => runConnectionOp(c, op, args, ctx)
      });
    });
  });
  return set;
}

export async function listWorkspaceTools() {
  return buildToolset(null, await connectionsStore.all(), { all: true });
}

// ---------------- Activity log ----------------
export async function logToolCall(entry) {
  const log = (await local.get("toolLog")) || [];
  log.unshift({ ts: Date.now(), ...entry });
  await local.set("toolLog", log.slice(0, LOG_LIMIT));
}
export const getToolLog = async () => (await local.get("toolLog")) || [];
