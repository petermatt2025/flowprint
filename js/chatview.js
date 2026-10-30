// Reusable chat window used by agents and chatbots.
import { esc, md } from "./ui.js";

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
      <form class="chat-input">
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
      <div class="bubble">${isUser ? esc(m.content).replace(/\n/g, "<br>") : md(m.content)}${actions}</div></div>`;
  }

  function render() {
    const greet = cfg.greeting ? bubble({ role: "assistant", content: cfg.greeting }, -1).replace(/<div class="msg-actions">[\s\S]*?<\/div>/, "") : "";
    log.innerHTML = greet + s.messages.map(bubble).join("");
    const chips = s.messages.length ? lastFollowUps : (cfg.starters || []);
    startersEl.innerHTML = chips.map(c => `<button class="pill" data-chip="${esc(c)}">${esc(c)}</button>`).join("");
    if (limited()) {
      input.disabled = true;
      input.placeholder = cfg.limitMessage || "Message limit reached.";
    }
    log.scrollTop = log.scrollHeight;
  }

  function setBusy(busy, stage = "") {
    sendBtn.classList.toggle("hidden", busy);
    stopBtn.classList.toggle("hidden", !busy);
    input.disabled = busy || limited();
    log.querySelector(".typing")?.remove();
    if (busy) {
      log.insertAdjacentHTML("beforeend", `<div class="msg bot typing">${cfg.avatar ? `<div class="avatar">${esc(cfg.avatar)}</div>` : ""}<div class="bubble"><span class="mini-spinner"></span>${esc(stage || "Thinking…")}</div></div>`);
      log.scrollTop = log.scrollHeight;
    }
  }

  async function send(text) {
    text = text.trim();
    if (!text || abort) return;
    if (limited()) { cfg.toast?.(cfg.limitMessage || "Message limit reached", true); return; }
    s.messages.push({ role: "user", content: text, ts: Date.now() });
    input.value = "";
    autosize();
    lastFollowUps = [];
    render();
    abort = new AbortController();
    setBusy(true);
    try {
      const raw = await cfg.send(s.messages.filter(m => !m.error), {
        signal: abort.signal,
        onStage: st => setBusy(true, st)
      });
      const { text: answer, followUps } = splitFollowUps(raw || "");
      lastFollowUps = followUps;
      s.messages.push({ role: "assistant", content: answer || "(empty reply)", ts: Date.now() });
      if (cfg.voice?.tts && cfg.voice.autoSpeak) speak(answer, cfg.voice);
    } catch (e) {
      if (e.name !== "AbortError") s.messages.push({ role: "assistant", content: `⚠ ${e.message}`, error: true, ts: Date.now() });
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
  log.addEventListener("click", async e => {
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
