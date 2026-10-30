// Agents and chatbots collections in chrome.storage.local.
import { local } from "./storage.js";
import { uid } from "./ui.js";

function collection(key) {
  const all = async () => (await local.get(key)) || [];
  return {
    all,
    get: async id => (await all()).find(x => x.id === id) || null,
    async save(item) {
      item.id ||= uid();
      item.updatedAt = Date.now();
      item.createdAt ||= item.updatedAt;
      const list = await all();
      const i = list.findIndex(x => x.id === item.id);
      if (i >= 0) list[i] = item; else list.unshift(item);
      await local.set(key, list);
      return item;
    },
    async remove(id) { await local.set(key, (await all()).filter(x => x.id !== id)); },
    async replaceAll(list) { await local.set(key, list); }
  };
}

export const agentsStore = collection("agents");
export const botsStore = collection("chatbots");

export function newAgent(over = {}) {
  return {
    id: uid(),
    name: "Untitled agent",
    folder: "",
    tags: [],
    systemPrompt: "",
    knowledge: { text: "", files: [] },
    memory: { enabled: true, notes: "" },
    output: { format: "markdown", length: "medium", language: "", instructions: "", creativity: "" },
    model: { provider: "", model: "" },
    integrations: { pageContext: false, webhook: { enabled: false, url: "" } },
    subAgents: [],
    sessions: [],
    ...over
  };
}

export function newBot(over = {}) {
  return {
    id: uid(),
    brainAgentId: "",
    identity: { name: "New chatbot", avatar: "🤖", description: "", greeting: "Hi! How can I help you today?" },
    experience: { starters: [], followUps: true, style: "", maxWords: null },
    ui: { accent: "#F97316", bubble: "rounded", density: "comfortable", showAvatar: true },
    capture: { enabled: false, fields: [{ label: "Name", type: "text", required: true }, { label: "Email", type: "email", required: true }], intro: "Before we start, tell us a bit about you." },
    access: { pin: "", messageLimit: null, limitMessage: "You've reached the message limit for this chat." },
    voice: { tts: false, autoSpeak: false, stt: true, voiceName: "", rate: 1, lang: "" },
    advanced: { historyTurns: 20, temperature: null, fallback: "Sorry, something went wrong. Please try again.", extraInstructions: "" },
    leads: [],
    sessions: [],
    ...over
  };
}
