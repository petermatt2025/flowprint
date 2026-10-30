// BYOK provider adapters. Each call goes straight from the browser to the provider.
// Model lists are fetched live from each provider so new releases show up without an update.

export const PROVIDERS = {
  anthropic: {
    label: "Anthropic",
    keyHint: "sk-ant-…",
    // Known current IDs; replaced by the live list after a key test.
    fallbackModels: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]
  },
  openai: { label: "OpenAI", keyHint: "sk-…", fallbackModels: [] },
  gemini: { label: "Gemini", keyHint: "AIza…", fallbackModels: [] },
  openrouter: { label: "OpenRouter", keyHint: "sk-or-…", fallbackModels: [] }
};

async function http(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.type || data?.message || text.slice(0, 300) || res.statusText;
    throw new Error(`${res.status}: ${msg}`);
  }
  return data;
}

const anthropicHeaders = key => ({
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
  "content-type": "application/json"
});

// ---------- Model lists ----------
export async function listModels(provider, key) {
  switch (provider) {
    case "anthropic": {
      const d = await http("https://api.anthropic.com/v1/models?limit=100", { headers: anthropicHeaders(key) });
      return d.data.map(m => ({ id: m.id, label: m.display_name || m.id }));
    }
    case "openai": {
      const d = await http("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
      const skip = /(audio|realtime|tts|transcribe|whisper|image|dall-e|embedding|moderation|search|instruct|babbage|davinci|codex-mini|computer-use)/i;
      return d.data
        .filter(m => /^(gpt-|o\d|chatgpt)/i.test(m.id) && !skip.test(m.id))
        .sort((a, b) => (b.created || 0) - (a.created || 0))
        .map(m => ({ id: m.id, label: m.id }));
    }
    case "gemini": {
      const d = await http(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`);
      const skip = /(embedding|imagen|aqa|tts|image|veo|live|native-audio)/i;
      return (d.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes("generateContent") && /gemini/i.test(m.name) && !skip.test(m.name))
        .map(m => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name }))
        .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
    }
    case "openrouter": {
      const d = await http("https://openrouter.ai/api/v1/models");
      return d.data
        .filter(m => !m.architecture || (m.architecture.output_modalities || ["text"]).includes("text"))
        .sort((a, b) => (b.created || 0) - (a.created || 0))
        .map(m => ({ id: m.id, label: m.name || m.id }));
    }
  }
  return [];
}

// Cheapest possible authenticated call to verify a key.
export async function testKey(provider, key) {
  if (provider === "openrouter") {
    await http("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` } });
    return listModels(provider, key);
  }
  return listModels(provider, key); // these list endpoints require a valid key
}

// ---------- Chat completion returning text ----------
export async function complete({ provider, key, model, system, user, maxTokens = 8000, json = true, signal }) {
  switch (provider) {
    case "anthropic": {
      const d = await http("https://api.anthropic.com/v1/messages", {
        method: "POST", signal, headers: anthropicHeaders(key),
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] })
      });
      if (d.stop_reason === "max_tokens") console.warn("Output hit max_tokens");
      return d.content.filter(c => c.type === "text").map(c => c.text).join("");
    }
    case "openai":
    case "openrouter": {
      const url = provider === "openai" ? "https://api.openai.com/v1/chat/completions" : "https://openrouter.ai/api/v1/chat/completions";
      const headers = { Authorization: `Bearer ${key}`, "content-type": "application/json" };
      if (provider === "openrouter") { headers["HTTP-Referer"] = "https://flowprint.app"; headers["X-Title"] = "FlowPrint"; }
      const body = {
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }]
      };
      if (provider === "openai") body.max_completion_tokens = maxTokens; else body.max_tokens = maxTokens;
      if (json) body.response_format = { type: "json_object" };
      let d;
      try {
        d = await http(url, { method: "POST", signal, headers, body: JSON.stringify(body) });
      } catch (e) {
        // Some models reject response_format; retry once without it.
        if (json && /response_format|json/i.test(e.message) && e.name !== "AbortError") {
          delete body.response_format;
          d = await http(url, { method: "POST", signal, headers, body: JSON.stringify(body) });
        } else throw e;
      }
      return d.choices?.[0]?.message?.content || "";
    }
    case "gemini": {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const d = await http(url, {
        method: "POST", signal, headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, ...(json ? { responseMimeType: "application/json" } : {}) }
        })
      });
      return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
    }
  }
  throw new Error(`Unknown provider ${provider}`);
}
