// Full-page chatbot (opened from Chatbots → Full page).
import { $ } from "./ui.js";
import { loadSettings, loadKeys } from "./storage.js";
import { botsStore, agentsStore } from "./store.js";
import { mountBotChat } from "./botchat.js";

function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg; t.classList.toggle("err", isErr); t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

async function start(fresh = false) {
  const id = new URLSearchParams(location.search).get("bot");
  const settings = await loadSettings();
  document.documentElement.dataset.theme = settings.theme;
  const [keys, bot, agents] = await Promise.all([loadKeys(settings.rememberKeys), botsStore.get(id), agentsStore.all()]);
  if (!bot) { $("#chatRoot").innerHTML = `<div class="empty">Chatbot not found. It may have been deleted.</div>`; return; }
  document.title = bot.identity.name;
  $("#botAvatar").textContent = bot.identity.avatar;
  $("#botAvatar").style.background = bot.ui.accent;
  $("#botName").textContent = bot.identity.name;
  $("#botDesc").textContent = bot.identity.description || "";
  mountBotChat($("#chatRoot"), {
    bot, agents, settings, keys, toast, preview: false, newSession: fresh,
    persist: async b => {
      // Merge with the stored copy so edits made in the builder meanwhile are kept.
      const latest = (await botsStore.get(b.id)) || b;
      const ids = new Set(b.sessions.map(s => s.id));
      latest.sessions = [...b.sessions, ...latest.sessions.filter(s => !ids.has(s.id))].slice(0, 50);
      const lids = new Set(b.leads.map(l => l.id));
      latest.leads = [...b.leads, ...latest.leads.filter(l => !lids.has(l.id))];
      await botsStore.save(latest);
    }
  });
}

$("#btnNewConvo").onclick = () => start(true);
start(true);
