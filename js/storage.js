// Thin wrapper over chrome.storage with a localStorage fallback (for previewing the panel as a plain page).
const hasChrome = typeof chrome !== "undefined" && chrome.storage?.local;

function area(name) {
  if (hasChrome && chrome.storage[name]) {
    return {
      get: k => chrome.storage[name].get(k).then(r => r[k]),
      set: (k, v) => chrome.storage[name].set({ [k]: v }),
      remove: k => chrome.storage[name].remove(k)
    };
  }
  const store = name === "session" ? sessionStorage : localStorage;
  return {
    get: async k => { try { return JSON.parse(store.getItem(`fp:${k}`)); } catch { return undefined; } },
    set: async (k, v) => store.setItem(`fp:${k}`, JSON.stringify(v)),
    remove: async k => store.removeItem(`fp:${k}`)
  };
}

export const local = area("local");
export const session = area("session");

export const DEFAULT_SETTINGS = {
  provider: "anthropic",
  models: { anthropic: "claude-sonnet-5-5", openai: "", gemini: "", openrouter: "" },
  modelLists: {},
  rememberKeys: true,
  maxTokens: 8000,
  theme: "dark"
};

export async function loadSettings() {
  const s = { ...DEFAULT_SETTINGS, ...((await local.get("settings")) || {}) };
  s.models = { ...DEFAULT_SETTINGS.models, ...(s.models || {}) };
  return s;
}
export const saveSettings = s => local.set("settings", s);

export async function loadKeys(remember) {
  return (await (remember ? local : session).get("keys")) || {};
}
export async function saveKeys(keys, remember) {
  if (remember) { await local.set("keys", keys); await session.remove("keys"); }
  else { await session.set("keys", keys); await local.remove("keys"); }
}
