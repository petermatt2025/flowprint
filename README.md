# FlowPrint – AI Agents, Chatbots & Workflows (Chrome extension)

A MindPal-style AI workspace that runs entirely in Chrome's side panel with your own API keys (BYOK). Three modules:

- **⚡ Workflows**: describe a repeatable task and AI builds a chain of agents. Run it with your inputs; each agent passes its output to the next. Saved in My workflows with run history.
- **🤖 AI Agents**: single agents with tabs for System prompt (with quality rating and ✨ Enhance with AI), Knowledge & Memory (notes, text files, current web page, remembered facts), Output settings (format, length, language, creativity), Language model (each agent can use its own provider/model), Integrations (read the current tab, webhook to Zapier/Make/n8n) and Sub-agents (consult other agents before answering). Chat with saved conversations. "Build agent with AI" creates one from a description.
- **💬 Chatbots**: branded chatbots powered by an agent "brain". 8-step builder: Choose the brain · Identity · Chat experience (starters, follow-up chips, style) · Interface (colour, bubbles) · Capture user info (lead form, leads table, CSV export) · Control access (PIN, message limit) · Voice mode (mic input, read-aloud) · Advanced (memory turns, creativity, fallback, extra instructions). Test in the panel or open as a **full-page chatbot** in its own tab.

Settings → Export includes all workflows, agents and chatbots (optionally API keys) so you can move everything to another computer.

## Install (unpacked, for testing)
1. Download/unzip this folder.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and select the `flowprint` folder.
4. Pin FlowPrint and click its icon (or press **Alt+Shift+F**). It opens in Chrome's **side panel**: drag the panel's left edge to resize it, or click **⤢** to pop it out into a full tab.

## Wizard steps
| Tab | Automated | Manual (shown as bullets in the panel) |
|---|---|---|
| 1 Setup | Provider + key test, live model list | Create API key, have a MindPal account |
| 2 Task | Presets, niche/output detection, blueprint generation | Write a specific task description |
| 3 Agents | Agent chain + system prompts, copy & "Improve with AI" | Create agents/nodes in MindPal, paste prompts |
| 4 Run | Input form, reference material, runs the agent chain, per-agent output, re-run from any agent, run history, Markdown download | Fill in your inputs |
| 5 Knowledge | Document checklist | Gather and upload files to MindPal |
| 6 Publish | Form title/description/instructions | Test, publish, share link (tickable checklist) |
| 7 Export | PDF / TXT / JSON / clipboard | — |

## My workflows (☰)
Every generated workflow is saved automatically. Run, edit, duplicate, export or delete it from the ☰ button. Each workflow keeps its last 20 runs.

## BYOK – supported providers
- **Anthropic** (Messages API, browser-direct header)
- **OpenAI** (Chat Completions, JSON mode)
- **Google Gemini** (generateContent, JSON response type)
- **OpenRouter** (OpenAI-compatible; any model on OpenRouter)

Model lists are pulled live from each provider's `/models` endpoint after a key test, so new models appear without an extension update. A custom model ID field covers anything not listed.

Keys are stored only in `chrome.storage.local` on this device (or `chrome.storage.session` if "Remember keys" is off) and are sent only to the chosen provider. There is no FlowPrint server.

## Settings
- API keys for all four providers
- Max output tokens, light/dark theme
- **Export / Import settings** (`flowprint-settings.json`) to move your setup to another computer – optionally including API keys
- **Load blueprint** to reopen a previously exported blueprint JSON

## Branding
All colors live in `theme.css` as CSS variables. Replace the placeholder hex values with the brand palette and the panel, buttons and PDF accent update automatically.

## Files
```
manifest.json      MV3 manifest (side_panel, storage, provider host permissions)
background.js      opens the side panel on toolbar click
sidepanel.html     wizard UI
theme.css          brand tokens
style.css          layout & components
js/app.js          controller / event wiring
js/engine.js       pure logic (parsing, validation, export text)
js/prompts.js      LLM prompt templates
js/presets.js      niche presets
js/providers.js    Anthropic / OpenAI / Gemini / OpenRouter adapters
js/exporter.js     PDF (jsPDF, bundled), TXT, JSON export
js/storage.js      chrome.storage wrapper
lib/jspdf.umd.min.js  jsPDF 2.5.1 (bundled – MV3 forbids remote code)
icons/             16/32/48/128 px icons
```

## Not yet included (by request)
- Licensing / funnel gating – to be added after the build is finalised.
- Chrome Web Store listing copy – to be written last, following the provided optimization instructions.
