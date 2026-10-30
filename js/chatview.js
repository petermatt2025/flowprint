// Reusable chat window used by agents and chatbots.
import { esc, md, pickFiles } from "./ui.js";
import { artifactCardHtml, hydrateArtifacts, artifactAction } from "./artifacts.js";

const FILE_LIMIT = 2_000_000;

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

export function speak(text, { voiceName = "", rate = 1, lang = "" } = {}) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const plain = text.replace(/```[\s\S]*?```/g, " code block ").replace(/[#*_`>|-]/g, " ");
  const u = new SpeechSynthesisUtterance(plain);
  const v = speechSynthesis.getVoices().find(x => x.name === voiceName);
  if (v) u.voice = v;
  if (lang) u.lang = lang;
  u.rate = rate || 1;
  speechSynthesis.speak(u);
}

// FOLLOWUPS: a | b | c  (last line of a reply) -> chips under the message
export function splitFollowUps(text) {
  const m = text.match(/\n?\s*FOLLOWUPS?:\s*(.+)\s*$/i);
  if (!m) return { text, followUps: [] };
  return { text: text.slice(0, m.index).trimEnd(), followUps: m[1].split("|").map(s => s.trim()).filter(Boolean).slice(0, 4) };
}

/**
 * cfg: {
 *   name, avatar, accent, bubble ("rounded"|"square"), greeting, starters[],
 *   session: { messages: [] }, onPersist(), send(messages, { signal, onStage }) -> Promise<string>,
 *   voice: { tts, autoSpeak, stt, voiceName, rate, lang }, onRemember(text) | null,
 *   limit: number|null, limitMessage, toast(msg, isErr)
 * }
 */
export function mountChat(el, cfg) {
  const s = cfg.session;
  s.messages ||= [];
  el.innerHTML = `
    <div class="chat ${cfg.bubble === "square" ? "square" : ""}" style="${cfg.accent ? `--chat-accent:${esc(cfg.accent)}` : ""}">
      <div class="chat-log" aria-live="polite"></div>
      <div class="chat-starters"></div>
      <div class="chat-files"></div>
      <form class="chat-input">
        ${cfg.allowFiles !== false ? `<button type="button" class="icon-btn attach" data-tip="Attach text files (CSV, TXT, JSON, MD…) – the agent can read them and the Code sandbox can analyse them">📎</button>` : ""}
        <textarea rows="1" placeholder="Type a message…  (Enter to send, Shift+Enter for a new line)"></textarea>
        ${cfg.voice?.stt && SR ? `<button type="button" class="icon-btn mic" data-tip="Speak instead of typing">🎤</button>` : ""}
        <button type="submit" class="btn primary send" data-tip="Send">➤</button>
        <button type="button" class="btn danger-ghost stop hidden" data-tip="Stop">■</button>
      </form>
    </div>`;
  const log = el.querySelector(".chat-log");
  const input = el.querySelector("textarea");
  const startersEl = el.querySelector(".chat-starters");
  const sendBtn = el.querySelector(".send");
  const stopBtn = el.querySelector(".stop");
  let abort = null;
  let lastFollowUps = [];
  let toolEvents = [];
  let attachments = [];
  let stageText = "";
  let plan = [];
  s.files ||= [];
  const filesEl = el.querySelector(".chat-files");
  const PLAN_ICON = { pending: "○", in_progress: '<span class="mini-spinner"></span>', done: "✓" };
  const planHtml = p => p?.length ? `<div class="plan"><b>Plan</b>${p.map(st => `<div class="plan-step ${esc(st.status)}"><span class="st">${PLAN_ICON[st.status] || "○"}</span> ${esc(st.text)}</div>`).join("")}</div>` : "";

  const STATUS_ICON = { running: '<span class="mini-spinner"></span>', done: "✓", error: "✗" };
  const toolsHtml = list => list?.length ? `<div class="tool-events">${list.map(t => `
      <div class="tool-ev ${t.status}"><span class="st">${STATUS_ICON[t.status] || ""}</span> ${esc(t.icon || "🔧")} ${esc(t.label)}${
        t.status === "error" ? `<div class="tool-err">Couldn't complete: ${esc(t.detail || "")}</div>` : ""}</div>`).join("")}</div>` : "";
  const attachHtml = list => (list || []).map(a => {
    if (a.type === "image" && a.src) return `<div class="gen-img"><img src="${esc(a.src)}" alt="${esc(a.prompt || "Generated image")}"/><a href="${esc(a.src)}" download="flowprint-image.png">⬇ Download</a></div>`;
    if (a.type === "gallery") return `<div class="gallery">${a.items.map(x => `<a href="${esc(x.link || x.full)}" target="_blank" rel="noopener" title="${esc(`${x.title} · ${x.license}`)}"><img src="${esc(x.src)}" alt="${esc(x.title)}" loading="lazy"/></a>`).join("")}</div>`;
    if (a.type === "artifact") return artifactCardHtml(a);
    if (a.type === "choices") return `<div class="choices-note">👇 Pick an answer below or type your own.</div>`;
    return "";
  }).join("");
  const choicesOf = m => m?.attachments?.find(a => a.type === "choices")?.options || [];
  function renderFiles() {
    filesEl.innerHTML = s.files.map((f, i) => `<span class="file-chip">📄 ${esc(f.name)} <button type="button" data-rmfile="${i}" aria-label="Remove">✕</button></span>`).join("");
  }

  const userCount = () => s.messages.filter(m => m.role === "user").length;
  const limited = () => cfg.limit && userCount() >= cfg.limit;

  function bubble(m, i) {
    const isUser = m.role === "user";
    const avatar = !isUser && cfg.avatar ? `<div class="avatar">${esc(cfg.avatar)}</div>` : "";
    const actions = !isUser && !m.error ? `<div class="msg-actions">
        <button data-act="copy" data-i="${i}" data-tip="Copy">⧉</button>
        ${"speechSynthesis" in window ? `<button data-act="speak" data-i="${i}" data-tip="Read aloud">🔊</button>` : ""}
        ${cfg.onRemember ? `<button data-act="remember" data-i="${i}" data-tip="Save this answer's key facts to the agent's memory">🧠</button>` : ""}
      </div>` : "";
    return `<div class="msg ${isUser ? "user" : "bot"} ${m.error ? "error" : ""}">${avatar}
      <div class="bubble">${isUser ? "" : planHtml(m.plan) + toolsHtml(m.tools)}${isUser ? esc(m.display || m.content).replace(/\n/g, "<br>") : md(m.content)}${isUser ? "" : attachHtml(m.attachments)}${actions}</div></div>`;
  }

  function render() {
    const greet = cfg.greeting ? bubble({ role: "assistant", content: cfg.greeting }, -1).replace(/<div class="msg-actions">[\s\S]*?<\/div>/, "") : "";
    log.innerHTML = greet + s.messages.map(bubble).join("");
    const last = s.messages[s.messages.length - 1];
    const chips = s.messages.length ? (lastFollowUps.length ? lastFollowUps : last?.role === "assistant" ? choicesOf(last) : []) : (cfg.starters || []);
    startersEl.innerHTML = chips.map(c => `<button class="pill" data-chip="${esc(c)}">${esc(c)}</button>`).join("");
    if (limited()) {
      input.disabled = true;
      input.placeholder = cfg.limitMessage || "Message limit reached.";
    }
    log.scrollTop = log.scrollHeight;
    renderFiles();
    hydrateArtifacts(log).then(() => { log.scrollTop = log.scrollHeight; });
  }

  function setBusy(busy, stage = "") {
    sendBtn.classList.toggle("hidden", busy);
    stopBtn.classList.toggle("hidden", !busy);
    input.disabled = busy || limited();
    log.querySelector(".typing")?.remove();
    if (busy) {
      if (stage) stageText = stage;
      log.insertAdjacentHTML("beforeend", `<div class="msg bot typing">${cfg.avatar ? `<div class="avatar">${esc(cfg.avatar)}</div>` : ""}<div class="bubble">${planHtml(plan)}${toolsHtml(toolEvents)}<span class="mini-spinner"></span>${esc(stageText || "Thinking…")}</div></div>`);
      log.scrollTop = log.scrollHeight;
    }
  }

  async function send(text) {
    text = text.trim();
    if (!text || abort) return;
    if (limited()) { cfg.toast?.(cfg.limitMessage || "Message limit reached", true); return; }
    const newFiles = s.files.filter(f => !f.sent);
    const fileNote = newFiles.map(f => `\n\n[Attached file: ${f.name} (${f.text.length.toLocaleString()} characters) – available to the code sandbox at /data/${f.name}]\n${f.text.slice(0, 3000)}${f.text.length > 3000 ? "\n…" : ""}`).join("");
    newFiles.forEach(f => { f.sent = true; });
    s.messages.push({ role: "user", content: text + fileNote, display: newFiles.length ? `${text}\n${newFiles.map(f => `📄 ${f.name}`).join("  ")}` : undefined, ts: Date.now() });
    input.value = "";
    autosize();
    lastFollowUps = [];
    render();
    abort = new AbortController();
    toolEvents = []; attachments = []; stageText = ""; plan = [];
    setBusy(true);
    try {
      const raw = await cfg.send(s.messages.filter(m => !m.error).map(({ role, content }) => ({ role, content })), {
        signal: abort.signal,
        onStage: st => setBusy(true, st),
        onTool: ev => {
          const i = toolEvents.findIndex(t => t.id === ev.id);
          if (i >= 0) toolEvents[i] = ev; else toolEvents.push(ev);
          setBusy(true, ev.status === "running" ? "Working…" : "Thinking…");
        },
        onAttachment: a => attachments.push(a),
        onPlan: steps => { plan = steps; setBusy(true); },
        files: s.files.map(({ name, text: t }) => ({ name, text: t }))
      });
      const { text: answer, followUps } = splitFollowUps(raw || "");
      lastFollowUps = followUps;
      s.messages.push({ role: "assistant", content: answer || "(empty reply)", ts: Date.now(),
        ...(toolEvents.length ? { tools: toolEvents.map(({ icon, label, status, detail }) => ({ icon, label, status, detail })) } : {}),
        ...(attachments.length ? { attachments } : {}),
        ...(plan.length ? { plan } : {}) });
      if (cfg.voice?.tts && cfg.voice.autoSpeak) speak(answer, cfg.voice);
    } catch (e) {
      if (e.name !== "AbortError") s.messages.push({ role: "assistant", content: `⚠ ${e.message}`, error: true, ts: Date.now(), ...(toolEvents.length ? { tools: [...toolEvents] } : {}) });
    } finally {
      abort = null;
      setBusy(false);
      render();
      cfg.onPersist?.();
      input.focus();
    }
  }

  function autosize() { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; }

  el.querySelector("form").addEventListener("submit", e => { e.preventDefault(); send(input.value); });
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input.value); } });
  input.addEventListener("input", autosize);
  stopBtn.addEventListener("click", () => abort?.abort());
  startersEl.addEventListener("click", e => { const c = e.target.closest("[data-chip]"); if (c) send(c.dataset.chip); });
  el.querySelector(".attach")?.addEventListener("click", async () => {
    const files = await pickFiles(".csv,.tsv,.txt,.md,.json,.xml,.html,.log,.py,.js,text/*");
    for (const f of files) {
      if (f.size > FILE_LIMIT) { cfg.toast?.(`${f.name} is over 2 MB`, true); continue; }
      s.files.push({ name: f.name.replace(/[^\w.\-]+/g, "_"), text: await f.text() });
    }
    renderFiles();
  });
  filesEl.addEventListener("click", e => { const b = e.target.closest("[data-rmfile]"); if (b) { s.files.splice(+b.dataset.rmfile, 1); renderFiles(); } });
  log.addEventListener("click", async e => {
    const art = e.target.closest("[data-art-act]");
    if (art) { try { await artifactAction(art); } catch (err) { cfg.toast?.(err.message, true); } return; }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const m = s.messages[+b.dataset.i];
    if (!m) return;
    if (b.dataset.act === "copy") { await navigator.clipboard.writeText(m.content).catch(() => {}); cfg.toast?.("Copied"); }
    if (b.dataset.act === "speak") speak(m.content, cfg.voice || {});
    if (b.dataset.act === "remember") cfg.onRemember?.(m.content);
  });

  const mic = el.querySelector(".mic");
  if (mic) {
    let rec = null;
    mic.addEventListener("click", () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = cfg.voice?.lang || navigator.language;
      rec.interimResults = true;
      rec.onresult = ev => { input.value = [...ev.results].map(r => r[0].transcript).join(" "); autosize(); };
      rec.onerror = ev => {
        if (ev.error === "not-allowed" && typeof chrome !== "undefined" && chrome.runtime?.getURL) {
          cfg.toast?.("Allow the microphone in the tab that opens, then try again", true);
          chrome.tabs.create({ url: chrome.runtime.getURL("mic.html") });
        } else cfg.toast?.(`Voice input error: ${ev.error}`, true);
      };
      rec.onend = () => { mic.classList.remove("live"); rec = null; if (input.value.trim()) send(input.value); };
      mic.classList.add("live");
      rec.start();
    });
  }

  render();
  return { send, render, destroy: () => abort?.abort() };
}
