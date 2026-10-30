// Runs a chatbot: access PIN → capture user info → chat with its brain agent.
import { esc, uid } from "./ui.js";
import { runAgent, CREATIVITY } from "./chat.js";
import { mountChat } from "./chatview.js";

function botSystem(bot, lead) {
  const id = bot.identity, ex = bot.experience, adv = bot.advanced;
  const parts = [`## Chatbot identity\nYou are "${id.name}", talking to a visitor in a chat window.${id.description ? ` ${id.description}` : ""} Stay in character as ${id.name}.`];
  const style = [ex.style, ex.maxWords && `Keep every reply under ${ex.maxWords} words.`].filter(Boolean);
  if (style.length) parts.push(`## Chat style\n${style.map(s => `- ${s}`).join("\n")}`);
  if (lead?.values && Object.keys(lead.values).length) {
    parts.push(`## Visitor details\n${Object.entries(lead.values).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\nUse their name naturally. Never repeat their contact details back unless asked.`);
  }
  if (adv.extraInstructions) parts.push(adv.extraInstructions);
  if (ex.followUps) parts.push(`After your answer, add ONE final line exactly in this form:\nFOLLOWUPS: short question 1 | short question 2 | short question 3\n(questions the visitor might want to ask next).`);
  return parts.join("\n\n");
}

/**
 * opts: { bot, agents, settings, keys, persist(bot) , toast, preview, newSession }
 * persist receives the bot with updated sessions/leads.
 */
export function mountBotChat(el, opts) {
  const { bot, toast } = opts;
  const pinKey = `fp-pin-ok-${bot.id}`;
  const unlocked = () => opts.preview || !bot.access.pin || sessionStorage.getItem(pinKey) === "1";

  bot.sessions ||= [];
  bot.leads ||= [];
  let session = !opts.newSession && bot.sessions[0];
  if (!session) { session = { id: uid(), messages: [], createdAt: Date.now(), leadId: null }; }

  const lead = () => bot.leads.find(l => l.id === session.leadId);

  function showPin() {
    el.innerHTML = `<form class="card gate"><div class="gate-avatar">${esc(bot.identity.avatar || "🔒")}</div>
      <h3>${esc(bot.identity.name)}</h3><p class="muted">This chatbot is protected. Enter the access PIN.</p>
      <input type="password" placeholder="PIN" autofocus /><button class="btn primary block">Unlock</button>
      <div class="status err"></div></form>`;
    el.querySelector("form").onsubmit = e => {
      e.preventDefault();
      if (el.querySelector("input").value === bot.access.pin) { sessionStorage.setItem(pinKey, "1"); start(); }
      else el.querySelector(".status").textContent = "Wrong PIN.";
    };
  }

  function showCapture() {
    const fields = bot.capture.fields || [];
    el.innerHTML = `<form class="card gate" style="--chat-accent:${esc(bot.ui.accent)}"><div class="gate-avatar">${esc(bot.identity.avatar || "👋")}</div>
      <h3>${esc(bot.identity.name)}</h3><p class="muted">${esc(bot.capture.intro || "")}</p>
      ${fields.map((f, i) => `<label for="cap-${i}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</label>
        <input id="cap-${i}" data-label="${esc(f.label)}" type="${esc(f.type || "text")}" ${f.required ? "required" : ""}/>`).join("")}
      <button class="btn primary block">Start chat</button></form>`;
    el.querySelector("form").onsubmit = e => {
      e.preventDefault();
      const values = Object.fromEntries([...el.querySelectorAll("[data-label]")].map(i => [i.dataset.label, i.value.trim()]));
      const l = { id: uid(), values, ts: Date.now(), sessionId: session.id };
      bot.leads.unshift(l);
      session.leadId = l.id;
      persist();
      showChat();
    };
  }

  function persist() {
    session.title ||= (session.messages.find(m => m.role === "user")?.content || "").slice(0, 50);
    if (session.messages.length || session.leadId) bot.sessions = [session, ...bot.sessions.filter(s => s.id !== session.id)].slice(0, 50);
    opts.persist?.(bot);
  }

  function showChat() {
    const agent = opts.agents.find(a => a.id === bot.brainAgentId);
    mountChat(el, {
      name: bot.identity.name,
      avatar: bot.ui.showAvatar !== false ? bot.identity.avatar : "",
      accent: bot.ui.accent,
      bubble: bot.ui.bubble,
      greeting: bot.identity.greeting,
      starters: bot.experience.starters,
      session,
      voice: bot.voice,
      limit: bot.access.messageLimit || null,
      limitMessage: bot.access.limitMessage,
      toast,
      onPersist: persist,
      send: async (messages, o) => {
        if (!agent) throw new Error("This chatbot has no brain agent. Choose one in the Brain tab.");
        try {
          return await runAgent(agent, messages, { settings: opts.settings, keys: opts.keys, agents: opts.agents }, {
            ...o,
            extraSystem: botSystem(bot, lead()),
            historyTurns: bot.advanced.historyTurns || 20,
            temperature: bot.advanced.temperature != null && bot.advanced.temperature !== "" ? CREATIVITY[bot.advanced.temperature] ?? Number(bot.advanced.temperature) : undefined
          });
        } catch (e) {
          if (e.name === "AbortError") throw e;
          throw new Error(`${bot.advanced.fallback || "Something went wrong."} (${e.message})`);
        }
      }
    });
  }

  function start() {
    if (!unlocked()) return showPin();
    if (bot.capture.enabled && !session.leadId) return showCapture();
    showChat();
  }
  start();
  return { session };
}

export function leadsToCsv(bot) {
  const cols = [...new Set(bot.leads.flatMap(l => Object.keys(l.values)))];
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [["Date", ...cols, "Conversation"].map(q).join(","),
    ...bot.leads.map(l => {
      const s = bot.sessions.find(x => x.id === l.sessionId);
      const convo = s ? s.messages.map(m => `${m.role}: ${m.content}`).join(" / ").slice(0, 2000) : "";
      return [new Date(l.ts).toLocaleString(), ...cols.map(c => l.values[c]), convo].map(q).join(",");
    })].join("\n");
}
