// Built-in agent tools, grouped like MindPal: Find information · Make things · Code and apps · Plan, remember and ask.
import { getActivePageText } from "./chat.js";
import { createArtifact } from "./artifacts.js";
import { fetchT, htmlToText, clip, toolName } from "./toolcore.js";

const S = (props, required = []) => ({ type: "object", properties: props, required });
const str = description => ({ type: "string", description });

export const TOOL_GROUPS = [
  ["find", "Find information"],
  ["make", "Make things"],
  ["code", "Code and apps"],
  ["plan", "Plan, remember and ask"],
  ["more", "More"]
];

// Old ids from earlier versions → current ids
export const BUILTIN_ALIASES = { read_webpage: "read_website", read_current_tab: "read_website", save_memory: "memory" };

function openTab(url) {
  if (typeof chrome !== "undefined" && chrome.tabs?.create) chrome.tabs.create({ url, active: false });
  else window.open(url, "_blank");
}

// ---------- Find information ----------
async function readUrl(url, signal) {
  if (!/^https?:\/\//i.test(url)) throw new Error("URL must start with http:// or https://");
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return readYouTube(yt[1], signal);
  const r = await fetchT(url, { headers: { Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,text/plain,application/json" } }, signal);
  if (!r.ok) throw new Error(`Page returned ${r.status}`);
  const type = r.headers.get("content-type") || "";
  const body = await r.text();
  if (/xml|rss|atom/.test(type) || /^\s*<\?xml|<rss|<feed/i.test(body.slice(0, 300))) return readFeed(body);
  return clip(type.includes("html") || /<html/i.test(body.slice(0, 500)) ? htmlToText(body) : body);
}

function readFeed(xml) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const title = doc.querySelector("channel > title, feed > title")?.textContent || "Feed";
  const items = [...doc.querySelectorAll("item, entry")].slice(0, 20).map((it, i) => {
    const t = it.querySelector("title")?.textContent?.trim();
    const link = it.querySelector("link")?.getAttribute("href") || it.querySelector("link")?.textContent?.trim();
    const date = it.querySelector("pubDate, published, updated")?.textContent?.trim();
    const sum = htmlToText(it.querySelector("description, summary, content")?.textContent || "").slice(0, 300);
    return `${i + 1}. ${t}${date ? ` (${date})` : ""}\n${link || ""}\n${sum}`;
  });
  return clip(`Feed: ${title}\n\n${items.join("\n\n")}`);
}

async function readYouTube(id, signal) {
  const r = await fetchT(`https://www.youtube.com/watch?v=${id}`, {}, signal);
  const html = await r.text();
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script>)/s);
  if (!m) return clip(htmlToText(html));
  const p = JSON.parse(m[1]);
  const d = p.videoDetails || {};
  let transcript = "";
  const track = p.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
  if (track?.baseUrl) {
    try {
      const x = await (await fetchT(track.baseUrl, {}, signal)).text();
      const doc = new DOMParser().parseFromString(x, "text/xml");
      transcript = [...doc.querySelectorAll("text, p")].map(n => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    } catch { /* captions unavailable */ }
  }
  return clip(`YouTube video: ${d.title}\nChannel: ${d.author}\nViews: ${d.viewCount}\nLength: ${Math.round((d.lengthSeconds || 0) / 60)} min\n\nDescription:\n${d.shortDescription || ""}\n\n${transcript ? `Transcript:\n${transcript}` : "(No transcript available.)"}`);
}

async function screenshotTab() {
  if (typeof chrome === "undefined" || !chrome.tabs?.captureVisibleTab) throw new Error("Screenshots only work inside the Chrome extension.");
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return chrome.tabs.captureVisibleTab(tab?.windowId, { format: "png" });
}

async function searchWeb(query, type, keys, signal, attach) {
  type ||= "web";
  if (type === "news") {
    const r = await fetchT(`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en`, {}, signal);
    if (!r.ok) throw new Error(`News search failed (${r.status})`);
    return readFeed(await r.text());
  }
  if (type === "places") {
    const r = await fetchT(`https://nominatim.openstreetmap.org/search?format=json&limit=8&addressdetails=0&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } }, signal);
    const d = await r.json();
    if (!d.length) return "No places found.";
    return d.map((p, i) => `${i + 1}. ${p.display_name}\nType: ${p.type} · https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`).join("\n\n");
  }
  if (type === "images") {
    const r = await fetchT(`https://api.openverse.org/v1/images/?page_size=8&q=${encodeURIComponent(query)}`, { headers: { Accept: "application/json" } }, signal);
    if (!r.ok) throw new Error(`Stock media search failed (${r.status})`);
    const d = await r.json();
    const items = (d.results || []).map(x => ({ src: x.thumbnail || x.url, full: x.url, title: x.title, link: x.foreign_landing_url, license: `${(x.license || "").toUpperCase()} ${x.license_version || ""}`.trim(), creator: x.creator }));
    if (items.length) attach({ type: "gallery", items });
    return items.map((x, i) => `${i + 1}. ${x.title} by ${x.creator || "unknown"} (${x.license})\n${x.full}`).join("\n\n") + "\n\n(The images are shown to the user as a gallery.)";
  }
  if (type === "social") {
    const out = [];
    try {
      const r = await fetchT(`https://www.reddit.com/search.json?limit=8&sort=relevance&q=${encodeURIComponent(query)}`, {}, signal);
      const d = await r.json();
      (d.data?.children || []).forEach(c => out.push(`Reddit r/${c.data.subreddit} · ${c.data.ups} upvotes · ${c.data.num_comments} comments\n${c.data.title}\nhttps://reddit.com${c.data.permalink}\n${(c.data.selftext || "").slice(0, 200)}`));
    } catch { /* reddit unavailable */ }
    try { out.push(await ddg(`${query} (site:x.com OR site:linkedin.com OR site:instagram.com OR site:tiktok.com OR site:facebook.com)`, signal)); } catch { /* ignore */ }
    if (!out.length) throw new Error("No social posts found.");
    return clip(out.join("\n\n"));
  }
  if (keys.tavily) {
    const r = await fetchT("https://api.tavily.com/search", {
      method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${keys.tavily}` },
      body: JSON.stringify({ query, max_results: 6, include_answer: true })
    }, signal);
    if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const d = await r.json();
    return [d.answer && `Summary: ${d.answer}`, ...(d.results || []).map((x, i) => `${i + 1}. ${x.title}\n${x.url}\n${x.content}`)].filter(Boolean).join("\n\n");
  }
  return ddg(query, signal);
}

async function ddg(query, signal) {
  const r = await fetchT(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {}, signal);
  if (!r.ok) throw new Error(`Search failed (${r.status})`);
  const doc = new DOMParser().parseFromString(await r.text(), "text/html");
  const items = [...doc.querySelectorAll(".result")].slice(0, 8).map(el => {
    const a = el.querySelector(".result__a");
    let href = a?.getAttribute("href") || "";
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) href = decodeURIComponent(m[1]);
    return a ? `${a.textContent.trim()}\n${href}\n${el.querySelector(".result__snippet")?.textContent.trim() || ""}` : "";
  }).filter(Boolean);
  if (!items.length) throw new Error("No results (try again, or add a Tavily key in Tools → Tool settings)");
  return items.map((x, i) => `${i + 1}. ${x}`).join("\n\n");
}

// ---------- Make things ----------
async function generateImage({ prompt, size }, env, signal) {
  const key = env.keys.openai;
  if (!key) throw new Error("Image generation needs an OpenAI API key (Settings → API keys).");
  const model = env.settings.tools?.imageModel || "gpt-image-1";
  const r = await fetchT("https://api.openai.com/v1/images/generations", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, prompt, size: size || "1024x1024", n: 1 })
  }, signal, 120000);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error?.message || `Image API ${r.status}`);
  const img = d.data?.[0];
  return img?.b64_json ? `data:image/png;base64,${img.b64_json}` : img?.url;
}

const artifactTool = kind => async (a, ctx) => {
  const art = await createArtifact(kind, a, ctx.agent);
  ctx.attach({ type: "artifact", id: art.id, kind, title: art.title });
  return `Created the ${kind} "${art.title}". It is shown to the user as a card they can open, edit and download. Don't paste its full content again – just say what you made and offer changes.`;
};

// ---------- Code ----------
let worker = null;
let seq = 0;
function runPython(code, files, signal) {
  return new Promise((resolve, reject) => {
    if (!worker) worker = new Worker(new URL("./pyworker.js", import.meta.url), { type: "module" });
    const id = ++seq;
    const kill = msg => { worker?.terminate(); worker = null; reject(new Error(msg)); };
    const timer = setTimeout(() => kill("Python timed out after 120s"), 120000);
    signal?.addEventListener("abort", () => { clearTimeout(timer); kill("Stopped"); }, { once: true });
    const onMsg = e => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      worker.removeEventListener("message", onMsg);
      const d = e.data;
      if (d.ok) resolve(clip(`${d.output || ""}${d.result ? `\nResult: ${d.result}` : ""}`.trim() || "(no output)"));
      else reject(new Error(`${d.output ? `${d.output}\n` : ""}${d.error}`.slice(-3000)));
    };
    worker.addEventListener("message", onMsg);
    worker.postMessage({ id, code, files });
  });
}

// ---------- Built-in tool catalogue ----------
// Each built-in can expose one or more functions to the model.
export const BUILTINS = [
  {
    id: "read_website", group: "find", icon: "🌐", name: "Read websites", desc: "Pages, videos and feeds, with screenshots",
    keywords: "read open url website page article youtube video transcript rss feed screenshot current tab scrape", needsSites: true,
    functions: [{
      name: "read_website",
      description: "Read a web page, YouTube video (title, description, transcript) or RSS/Atom feed. Leave url empty to read the user's current browser tab. Set screenshot=true to capture the current tab as an image.",
      schema: S({ url: str("Full URL (https://…). Empty = the user's current tab"), screenshot: { type: "boolean", description: "Capture a screenshot of the current tab" } }),
      label: a => (a.screenshot && !a.url ? "Taking a screenshot of your tab" : a.url ? `Reading ${a.url}` : "Reading your current tab"),
      run: async (a, ctx) => {
        let out = "";
        if (a.screenshot) {
          const src = await screenshotTab();
          ctx.attach({ type: "image", src, prompt: "Screenshot of the current tab" });
          out += "A screenshot of the current tab is shown to the user.\n\n";
        }
        return out + (a.url ? await readUrl(a.url, ctx.signal) : await getActivePageText());
      }
    }]
  },
  {
    id: "web_search", group: "find", icon: "🔎", name: "Web search", desc: "Web, news, places, social posts and stock media",
    keywords: "search google internet research news places maps social reddit twitter posts stock images photos media trends",
    functions: [{
      name: "web_search",
      description: "Search the internet. type: web (default), news (latest articles), places (businesses/addresses with map links), social (Reddit, X, LinkedIn, Instagram, TikTok posts) or images (free stock photos with licences).",
      schema: S({ query: str("What to search for"), type: { type: "string", enum: ["web", "news", "places", "social", "images"], description: "Kind of search" } }, ["query"]),
      label: a => `Searching ${a.type && a.type !== "web" ? `${a.type} ` : "the web "}for "${a.query}"`,
      run: (a, ctx) => searchWeb(a.query, a.type, ctx.env.keys, ctx.signal, ctx.attach)
    }]
  },
  {
    id: "generate_image", group: "make", icon: "🎨", name: "Image generation", desc: "Images from a prompt",
    keywords: "image picture photo art design generate draw thumbnail graphic illustration",
    functions: [{
      name: "generate_image", description: "Generate an image from a detailed prompt (uses the user's OpenAI key).",
      schema: S({ prompt: str("Detailed description of the image"), size: { type: "string", enum: ["1024x1024", "1024x1536", "1536x1024"], description: "Square, portrait or landscape" } }, ["prompt"]),
      label: a => `Creating an image: "${String(a.prompt).slice(0, 60)}"`,
      run: async (a, ctx) => {
        ctx.attach({ type: "image", src: await generateImage(a, ctx.env, ctx.signal), prompt: a.prompt });
        return "The image was generated and is shown to the user. Don't paste a link to it.";
      }
    }]
  },
  {
    id: "text_document", group: "make", icon: "📄", name: "Text document", desc: "An editable document",
    keywords: "document doc write article blog post report ebook chapter letter word editable",
    functions: [{
      name: "create_document", description: "Create an editable document (article, report, ebook chapter, script…). The user can edit it and download it as Word or Markdown.",
      schema: S({ title: str("Document title"), content: str("Full document in Markdown") }, ["title", "content"]),
      label: a => `Writing document "${a.title}"`, run: artifactTool("document")
    }]
  },
  {
    id: "html_page", group: "make", icon: "🧾", name: "HTML page", desc: "Pages, mind maps and flashcards",
    keywords: "html page landing web mind map mindmap flashcards quiz infographic visual",
    functions: [{
      name: "create_html_page", description: "Create a self-contained HTML page (landing page, mind map, flashcards, quiz, infographic). Put all CSS and JS inline; no external files except Google Fonts or a CDN script if essential.",
      schema: S({ title: str("Page title"), html: str("Complete HTML document"), kind: { type: "string", enum: ["page", "mind map", "flashcards"], description: "What it is" } }, ["title", "html"]),
      label: a => `Building ${a.kind || "page"} "${a.title}"`, run: artifactTool("page")
    }]
  },
  {
    id: "carousel", group: "make", icon: "🖼", name: "Carousel", desc: "Instagram-style carousels",
    keywords: "carousel instagram slides post linkedin swipe social graphics",
    functions: [{
      name: "create_carousel", description: "Create an Instagram-style carousel (1080×1350 slides). Slide 1 is the hook, the last slide is the call to action. Keep each slide short.",
      schema: S({
        title: str("Carousel name"),
        slides: { type: "array", description: "3–10 slides", items: S({ heading: str("Big text, max ~8 words"), body: str("Supporting text, max ~30 words") }, ["heading"]) },
        handle: str("Optional @handle shown on each slide"),
        accent: str("Optional accent colour hex, e.g. #F97316")
      }, ["title", "slides"]),
      label: a => `Designing carousel "${a.title}" (${a.slides?.length || 0} slides)`, run: artifactTool("carousel")
    }]
  },
  {
    id: "slides", group: "make", icon: "📽", name: "Slides", desc: "Slide decks",
    keywords: "slides deck presentation powerpoint pptx pitch webinar",
    functions: [{
      name: "create_slides", description: "Create a slide deck the user can preview and download as PowerPoint (.pptx).",
      schema: S({
        title: str("Deck title"), subtitle: str("Optional subtitle"),
        slides: { type: "array", items: S({ title: str("Slide title"), bullets: { type: "array", items: { type: "string" }, description: "3–6 short bullet points" }, notes: str("Speaker notes") }, ["title"]) }
      }, ["title", "slides"]),
      label: a => `Building deck "${a.title}" (${a.slides?.length || 0} slides)`, run: artifactTool("slides")
    }]
  },
  {
    id: "code_sandbox", group: "code", icon: "🐍", name: "Code sandbox", desc: "Runs Python and analyses files",
    keywords: "python code run calculate analyse analyze data csv spreadsheet statistics math file",
    functions: [{
      name: "run_python",
      description: "Run Python 3 (standard library: csv, json, statistics, math, re, datetime, collections…). Files the user attached are at /data/<filename>. Print what you need to see.",
      schema: S({ code: str("Python code to run") }, ["code"]),
      label: () => "Running Python",
      run: (a, ctx) => runPython(a.code, ctx.files || [], ctx.signal)
    }]
  },
  {
    id: "app_builder", group: "code", icon: "🧱", name: "App builder", desc: "Builds and previews a web app · beta",
    keywords: "app build web app tool calculator quiz game form dashboard interactive",
    functions: [{
      name: "build_app", description: "Build a small interactive web app as ONE self-contained HTML file (inline CSS + JS, no build step). It is previewed live for the user. To change it, call again with the full updated file.",
      schema: S({ title: str("App name"), html: str("Complete HTML document with inline <style> and <script>") }, ["title", "html"]),
      label: a => `Building app "${a.title}"`, run: artifactTool("app")
    }]
  },
  {
    id: "task_plan", group: "plan", icon: "✅", name: "Task plan", desc: "Plans multi-step work and ticks it off",
    keywords: "plan steps checklist todo tasks project multi-step",
    functions: [{
      name: "update_plan", description: "Show the user a step-by-step plan for multi-step work. Call it first with all steps 'pending', then again as you progress, marking steps 'in_progress' or 'done'.",
      schema: S({ steps: { type: "array", items: S({ text: str("Step"), status: { type: "string", enum: ["pending", "in_progress", "done"] } }, ["text", "status"]) } }, ["steps"]),
      label: a => `Updating plan (${(a.steps || []).filter(s => s.status === "done").length}/${(a.steps || []).length} done)`,
      run: async (a, ctx) => { ctx.plan?.(a.steps || []); return "Plan shown to the user."; }
    }]
  },
  {
    id: "memory", group: "plan", icon: "🧠", name: "Memory", desc: "Remembers notes from your own chats",
    keywords: "remember memory notes facts preferences past chats history recall",
    functions: [
      {
        name: "save_memory", description: "Save a lasting fact about the user or their business to memory.",
        schema: S({ fact: str("Short fact to remember") }, ["fact"]),
        label: a => `Remembering: "${String(a.fact).slice(0, 60)}"`,
        run: async (a, ctx) => {
          ctx.agent.memory ||= { enabled: true, notes: "" };
          ctx.agent.memory.notes = `${(ctx.agent.memory.notes || "").trim()}\n- ${a.fact}`.trim();
          ctx.agent.memory.enabled = true;
          await ctx.saveAgent?.(ctx.agent);
          return "Saved to memory.";
        }
      },
      {
        name: "search_past_chats", description: "Search the user's earlier conversations with you for something they said before.",
        schema: S({ query: str("Keywords to look for") }, ["query"]),
        label: a => `Searching past chats for "${a.query}"`,
        run: async (a, ctx) => {
          const words = a.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
          const hits = [];
          (ctx.agent.sessions || []).forEach(s => s.messages.forEach(m => {
            const t = (m.content || "").toLowerCase();
            const score = words.filter(w => t.includes(w)).length;
            if (score) hits.push({ score, text: `[${new Date(m.ts || s.createdAt).toLocaleDateString()} ${m.role}] ${m.content.slice(0, 400)}` });
          }));
          return hits.sort((x, y) => y.score - x.score).slice(0, 6).map(h => h.text).join("\n\n") || "Nothing found in past chats.";
        }
      }
    ]
  },
  {
    id: "clarify", group: "plan", icon: "❓", name: "Clarifying questions", desc: "Asks with choices before guessing, on your web chatbot",
    keywords: "ask question clarify choices options confirm",
    functions: [{
      name: "ask_user", description: "When the request is ambiguous, ask ONE short question with 2–5 clickable answer options instead of guessing. After calling this, end your turn with just the question.",
      schema: S({ question: str("The question"), options: { type: "array", items: { type: "string" }, description: "2–5 short answer options" } }, ["question", "options"]),
      label: () => "Asking you a question",
      run: async (a, ctx) => { ctx.attach({ type: "choices", question: a.question, options: (a.options || []).slice(0, 5) }); return "The options are shown to the user. Stop here: reply with only the question and wait."; }
    }]
  },
  {
    id: "workspace_tools", group: "plan", icon: "🧭", name: "Find workspace tools", desc: "Finds and runs your workspace's other tools when it needs one",
    keywords: "find tools workspace apps discover run any connected",
    functions: [
      {
        name: "find_workspace_tools", description: "Search ALL tools connected in this workspace (MCP servers, apps, webhooks, APIs), including ones not enabled for you. Returns names, descriptions and inputs.",
        schema: S({ query: str("What you want to do, e.g. 'send email' or 'add contact'") }, ["query"]),
        label: a => `Looking for a tool to "${a.query}"`,
        run: async (a, ctx) => {
          const { listWorkspaceTools } = await import("./tools.js");
          const words = a.query.toLowerCase().split(/\s+/).filter(Boolean);
          const all = await listWorkspaceTools();
          const found = all.map(t => ({ t, score: words.filter(w => `${t.name} ${t.description}`.toLowerCase().includes(w)).length })).filter(x => x.score).sort((x, y) => y.score - x.score).slice(0, 8);
          return found.length ? found.map(({ t }) => `- ${t.name}: ${t.description}\n  inputs: ${JSON.stringify(t.schema.properties)}`).join("\n") : "No matching tool. The user can connect apps in FlowPrint → Tools.";
        }
      },
      {
        name: "run_workspace_tool", description: "Run a tool found with find_workspace_tools.",
        schema: S({ tool: str("Exact tool name"), arguments: str("JSON object with the tool's inputs") }, ["tool"]),
        label: a => `Running ${a.tool}`,
        run: async (a, ctx) => {
          const { listWorkspaceTools } = await import("./tools.js");
          const t = (await listWorkspaceTools()).find(x => x.name === a.tool);
          if (!t) throw new Error(`No tool named ${a.tool}`);
          let args = {};
          try { args = typeof a.arguments === "string" ? JSON.parse(a.arguments || "{}") : a.arguments || {}; } catch { throw new Error("arguments must be valid JSON"); }
          return t.run(args, ctx);
        }
      }
    ]
  },
  // ----- extras beyond MindPal -----
  {
    id: "draft_email", group: "more", icon: "✉️", name: "Draft an email", desc: "Opens a pre-filled Gmail draft to review and send",
    keywords: "send email gmail mail compose outreach",
    functions: [{
      name: "draft_email", description: "Open a pre-filled Gmail draft for the user to review and send.",
      schema: S({ to: str("Recipient(s)"), subject: str("Subject"), body: str("Plain-text body") }, ["subject", "body"]),
      label: a => `Drafting an email${a.to ? ` to ${a.to}` : ""}`,
      run: async a => { openTab(`https://mail.google.com/mail/?${new URLSearchParams({ view: "cm", fs: "1", to: a.to || "", su: a.subject || "", body: a.body || "" })}`); return "Gmail draft opened in a new tab."; }
    }]
  },
  {
    id: "open_link", group: "more", icon: "🔗", name: "Open a link", desc: "Opens a URL in a new tab for you",
    keywords: "open link tab browser navigate",
    functions: [{
      name: "open_link", description: "Open a URL in a new browser tab.", schema: S({ url: str("URL") }, ["url"]),
      label: a => `Opening ${a.url}`,
      run: async a => { if (!/^https?:\/\//i.test(a.url)) throw new Error("Only http(s) links"); openTab(a.url); return "Opened."; }
    }]
  },
  {
    id: "current_datetime", group: "more", icon: "🕒", name: "Date & time", desc: "Knows today's date, time and timezone",
    keywords: "date time today now timezone",
    functions: [{
      name: "current_datetime", description: "Get the current date, time and timezone.", schema: S({}),
      label: () => "Checking the date", run: async () => `${new Date().toString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
    }]
  }
];

export const normalizeBuiltins = ids => [...new Set((ids || []).map(id => BUILTIN_ALIASES[id] || id).filter(id => BUILTINS.some(b => b.id === id)))];
export { toolName };
