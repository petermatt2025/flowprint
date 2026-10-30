import { PRESETS, OUTPUT_TYPES } from "./presets.js";
import { PROVIDERS, listModels, testKey, complete } from "./providers.js";
import { REWRITE_AGENT_PROMPT } from "./prompts.js";
import {
  parseTaskInput, selectPreset, buildAgentChainPrompt, parseBlueprint, validateBlueprint,
  buildPublishingSteps, formCopyText, fieldsText, buildExportText, extractJson
} from "./engine.js";
import { exportPdf, exportTxt, exportJson, downloadBlob } from "./exporter.js";
import { local, loadSettings, saveSettings, loadKeys, saveKeys } from "./storage.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STEPS = ["setup", "task", "agents", "fields", "knowledge", "publish", "export"];
const LOADING_MSGS = ["Mapping your agent chain…", "Writing agent prompts…", "Building your form field list…", "Preparing your knowledge checklist…", "Finalizing your blueprint…"];

const state = {
  settings: null,
  keys: {},
  step: "setup",
  prevStep: "setup",
  blueprint: null,
  draft: { task: "", tone: "Conversational", niche: "", outputs: [], preset: null },
  abort: null
};

// ---------------- Utilities ----------------
function toast(msg, isErr = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("err", isErr);
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}
async function copy(text, label = "Copied") {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch { toast("Clipboard blocked – select and copy manually", true); }
}
const currentModel = () => $("#customModel").value.trim() || $("#model").value;
const persistDraft = () => local.set("draft", state.draft);
const persistBlueprint = () => local.set("blueprint", state.blueprint);

// ---------------- Tooltips ----------------
function initTooltips() {
  const tip = $("#tooltip");
  let target = null;
  document.addEventListener("mouseover", e => {
    const el = e.target.closest("[data-tip]");
    if (!el || el === target || !el.dataset.tip) return;
    target = el;
    tip.textContent = el.dataset.tip;
    const r = el.getBoundingClientRect();
    tip.classList.add("show");
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
    let top = r.bottom + 8;
    if (top + th > window.innerHeight - 8) top = r.top - th - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  document.addEventListener("click", () => { tip.classList.remove("show"); target = null; }, true);
  document.addEventListener("mouseout", e => {
    if (target && !target.contains(e.relatedTarget)) { tip.classList.remove("show"); target = null; }
  });
}

// ---------------- Navigation ----------------
function canEnter(step) {
  if (step === "setup" || step === "task" || step === "settings") return true;
  return !!state.blueprint;
}
function go(step) {
  if (!canEnter(step)) return;
  if (step === "settings" && state.step !== "settings") state.prevStep = state.step;
  state.step = step;
  $$(".step").forEach(s => s.classList.toggle("active", s.dataset.step === step));
  const idx = STEPS.indexOf(step);
  $$("#stepTabs button").forEach(b => {
    const i = STEPS.indexOf(b.dataset.step);
    b.classList.toggle("active", b.dataset.step === step);
    b.classList.toggle("done", idx > i || (state.blueprint && i <= 1));
    b.disabled = !canEnter(b.dataset.step);
  });
  const inWizard = idx >= 0;
  $(".navbar").classList.toggle("hidden", !inWizard);
  if (inWizard) {
    $("#stepIndicator").textContent = `Step ${idx + 1} of ${STEPS.length}`;
    $("#btnBack").disabled = idx === 0;
    const next = STEPS[idx + 1];
    $("#btnNext").disabled = !next || !canEnter(next) || (step === "setup" && !state.keys[state.settings.provider]);
    $("#btnNext").textContent = next ? "Next →" : "Done";
  }
  $("#main").scrollTop = 0;
  if (step !== "settings") local.set("step", step);
}

// ---------------- Step 1: Setup ----------------
function renderProviders() {
  $("#providerPills").innerHTML = Object.entries(PROVIDERS)
    .map(([k, p]) => `<button class="pill ${k === state.settings.provider ? "active" : ""}" data-provider="${k}">${p.label}</button>`)
    .join("");
  const p = state.settings.provider;
  $("#apiKey").value = state.keys[p] || "";
  $("#apiKey").placeholder = PROVIDERS[p].keyHint;
  $("#keyStatus").textContent = "";
  $("#keyStatus").className = "status";
  renderModels();
}

function renderModels() {
  const p = state.settings.provider;
  const list = state.settings.modelLists[p]?.length
    ? state.settings.modelLists[p]
    : PROVIDERS[p].fallbackModels.map(id => ({ id, label: id }));
  const sel = $("#model");
  const chosen = state.settings.models[p];
  if (!list.length) {
    sel.innerHTML = `<option value="">Test your key to load models</option>`;
  } else {
    sel.innerHTML = list.map(m => `<option value="${esc(m.id)}">${esc(m.label)}${m.label !== m.id ? ` (${esc(m.id)})` : ""}</option>`).join("");
    if (chosen && list.some(m => m.id === chosen)) sel.value = chosen;
    else state.settings.models[p] = sel.value;
  }
  $("#customModel").value = chosen && !list.some(m => m.id === chosen) ? chosen : "";
}

async function refreshModels({ quiet = false } = {}) {
  const p = state.settings.provider;
  const key = state.keys[p];
  if (!key && p !== "openrouter") { if (!quiet) toast("Enter an API key first", true); return; }
  try {
    const models = await listModels(p, key);
    if (models.length) {
      state.settings.modelLists[p] = models;
      await saveSettings(state.settings);
      renderModels();
      if (!quiet) toast(`${models.length} models loaded`);
    }
  } catch (e) { if (!quiet) toast(`Couldn't load models: ${e.message}`, true); }
}

async function onTestKey() {
  const p = state.settings.provider;
  const key = $("#apiKey").value.trim();
  const st = $("#keyStatus");
  if (!key) { st.textContent = "Enter a key first."; st.className = "status err"; return; }
  st.textContent = "Testing…"; st.className = "status";
  try {
    const models = await testKey(p, key);
    state.keys[p] = key;
    await saveKeys(state.keys, state.settings.rememberKeys);
    if (models?.length) { state.settings.modelLists[p] = models; await saveSettings(state.settings); }
    renderModels();
    st.textContent = `✓ Key works – ${models?.length || 0} models available`;
    st.className = "status ok";
    go(state.step);
  } catch (e) {
    st.textContent = `✗ ${e.message}`;
    st.className = "status err";
  }
}

// ---------------- Step 2: Task ----------------
function renderTaskStep() {
  $("#presetPills").innerHTML = Object.entries(PRESETS)
    .map(([k, p]) => `<button class="pill ${state.draft.preset === k ? "active" : ""}" data-preset="${k}" data-tip="${esc(p.agentRoles.join(" → "))}">${esc(p.name)}</button>`)
    .join("");
  $("#outputTypes").innerHTML = OUTPUT_TYPES
    .map(o => `<label><input type="checkbox" value="${o.key}" ${state.draft.outputs.includes(o.key) ? "checked" : ""}/> ${o.label}</label>`)
    .join("");
  $("#taskText").value = state.draft.task;
  $("#tone").value = state.draft.tone;
  $("#niche").value = state.draft.niche;
  updateTaskUI();
}

function updateTaskUI() {
  $("#charCount").textContent = $("#taskText").value.length;
  const p = state.settings.provider;
  $("#btnGenerate").disabled = !$("#taskText").value.trim() || !state.keys[p] || !currentModel();
  $("#btnGenerate").dataset.tip = !state.keys[p] ? "Add and test an API key in step 1 first" : "";
  $("#btnGenerate").textContent = state.blueprint ? "Regenerate Blueprint" : "Generate Blueprint";
}

let debounce;
function onTaskInput() {
  state.draft.task = $("#taskText").value;
  updateTaskUI();
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const parsed = parseTaskInput(state.draft.task);
    if (!state.draft.nicheTouched) { state.draft.niche = parsed.inferredNiche; $("#niche").value = parsed.inferredNiche; }
    if (!state.draft.outputsTouched) {
      state.draft.outputs = parsed.inferredOutputTypes;
      $$("#outputTypes input").forEach(cb => { cb.checked = parsed.inferredOutputTypes.includes(cb.value); });
    }
    persistDraft();
  }, 300);
}

function applyPreset(key) {
  const p = selectPreset(key);
  if (!p) return;
  state.draft.preset = key;
  state.draft.task = p.taskDescription;
  state.draft.outputs = p.outputTypes;
  state.draft.outputsTouched = false;
  state.draft.nicheTouched = false;
  renderTaskStep();
  onTaskInput();
}

async function generate() {
  const p = state.settings.provider;
  const parsed = parseTaskInput(state.draft.task);
  const preset = selectPreset(state.draft.preset);
  const presetHint = preset ? `${preset.name}: agents ${preset.agentRoles.join(" → ")}; fields ${preset.suggestedFields.join(", ")}; knowledge ${preset.knowledgeSources.join(", ")}` : "";
  const outputs = state.draft.outputs.map(k => OUTPUT_TYPES.find(o => o.key === k)?.label || k);
  const { system, user } = buildAgentChainPrompt(parsed.taskSummary, state.draft.niche, outputs, state.draft.tone, presetHint);

  $("#genError").classList.add("hidden");
  $("#btnGenerate").classList.add("hidden");
  $("#loading").classList.remove("hidden");
  let i = 0;
  $("#loadingMsg").textContent = LOADING_MSGS[0];
  const rot = setInterval(() => { $("#loadingMsg").textContent = LOADING_MSGS[++i % LOADING_MSGS.length]; }, 2000);
  state.abort = new AbortController();

  try {
    const raw = await complete({
      provider: p, key: state.keys[p], model: currentModel(), system, user,
      maxTokens: state.settings.maxTokens, signal: state.abort.signal
    });
    const bp = parseBlueprint(raw);
    if (bp.error) {
      showGenError("The AI reply wasn't valid blueprint JSON. You can retry, or try a different model.", bp.raw);
      return;
    }
    bp.meta = { niche: state.draft.niche, outputTypes: outputs, tone: state.draft.tone, provider: p, model: currentModel(), createdAt: new Date().toISOString() };
    bp.checks = { knowledge: [], publish: [] };
    state.blueprint = bp;
    await persistBlueprint();
    renderBlueprint();
    go("agents");
  } catch (e) {
    if (e.name === "AbortError") toast("Cancelled");
    else showGenError(e.message);
  } finally {
    clearInterval(rot);
    state.abort = null;
    $("#loading").classList.add("hidden");
    $("#btnGenerate").classList.remove("hidden");
    updateTaskUI();
  }
}

function showGenError(msg, raw) {
  const el = $("#genError");
  el.innerHTML = `<b>Generation failed.</b> ${esc(msg)}${raw ? `<pre>${esc(raw)}</pre>` : ""}<button class="btn ghost small" id="btnRetry">Retry</button>`;
  el.classList.remove("hidden");
  $("#btnRetry").onclick = generate;
}

// ---------------- Steps 3–6: Blueprint ----------------
function renderBlueprint() {
  const bp = state.blueprint;
  if (!bp) return;
  const { warnings } = validateBlueprint(bp);
  $("#warnings").innerHTML = warnings.length ? `⚠ <b>Check these before building:</b><ul>${warnings.map(w => `<li>${esc(w)}</li>`).join("")}</ul>` : "";
  $("#warnings").classList.toggle("hidden", !warnings.length);

  $("#wfTitle").textContent = bp.workflowTitle;
  $("#wfDesc").textContent = bp.workflowDescription;
  const tags = [bp.meta?.niche, ...(bp.meta?.outputTypes || []), bp.meta?.model].filter(Boolean);
  $("#wfTags").innerHTML = tags.map(t => `<span class="tag">${esc(t)}</span>`).join("");
  $("#agentCount").textContent = `${bp.agents.length} agents`;

  $("#agentList").innerHTML = bp.agents.map((a, i) => `
    ${i ? '<div class="arrow">↓</div>' : ""}
    <div class="card agent-card" data-i="${i}">
      <h4><span class="agent-num">${a.agentNumber}</span>${esc(a.agentName)}</h4>
      <div class="muted">${esc(a.role)}</div>
      <dl>
        <dt>Input</dt><dd>${esc(a.inputSource)}</dd>
        <dt>Output</dt><dd>${esc(a.outputDescription)}</dd>
      </dl>
      <label>System prompt <i class="tip" data-tip="Edit freely – changes are saved and included in every export.">?</i></label>
      <textarea class="code agent-prompt" data-i="${i}" rows="8">${esc(a.systemPrompt)}</textarea>
      <div class="agent-actions">
        <button class="btn primary small" data-copy-agent="${i}">Copy prompt</button>
        <button class="btn ghost small" data-improve-agent="${i}" data-tip="Ask the AI to make this prompt more specific and structured">✨ Improve with AI</button>
      </div>
    </div>`).join("");

  $("#agentsManual").innerHTML = [
    `In MindPal open <b>Workflows → Create workflow</b> and name it "${esc(bp.workflowTitle)}".`,
    ...bp.agents.map(a => `Add an <b>Agent node</b> → create agent "<b>${esc(a.agentName)}</b>" → paste its system prompt → set its input to: ${esc(a.inputSource)}.`),
    "Pick the model for each agent inside MindPal (heavier writing agents benefit from a stronger model).",
    "Connect the nodes in the order shown above."
  ].map(t => `<li>${t}</li>`).join("");

  $("#fieldTable tbody").innerHTML = bp.formFields.map(f => `
    <tr><td><b>${esc(f.fieldName)}</b></td><td>${esc(f.fieldType)}</td><td>${esc(f.description)}</td><td class="muted">${esc(f.exampleValue)}</td></tr>`).join("");
  $("#fieldsManual").innerHTML = [
    "In your workflow, open the <b>Workflow Input / form</b> settings.",
    ...bp.formFields.map(f => `Add a <b>${esc(f.fieldType)}</b> field named "<b>${esc(f.fieldName)}</b>"${f.fieldType === "dropdown" ? " and enter its options" : ""}.`),
    "Mark the essential fields as required.",
    "Insert each field into the agent prompts where you see {{Field Name}} using MindPal's variable picker."
  ].map(t => `<li>${t}</li>`).join("");

  renderChecklist("#knowledgeList", "knowledge", bp.knowledgeSources.map(k => ({ text: k.documentType, sub: `${k.whatItShouldContain} — <i>${k.whyItMatters}</i>` })));
  renderChecklist("#publishList", "publish", buildPublishingSteps(bp).map(s => ({ text: s.text, sub: esc(s.sub) })), true);
  $("#formCopy").textContent = formCopyText(bp);
}

function renderChecklist(sel, key, items, subIsEscaped = false) {
  const checked = state.blueprint.checks?.[key] || [];
  $(sel).innerHTML = items.map((it, i) => `
    <li class="${checked.includes(i) ? "checked" : ""}">
      <input type="checkbox" data-check="${key}" data-i="${i}" ${checked.includes(i) ? "checked" : ""}/>
      <span class="txt"><b>${esc(it.text)}</b><span class="sub">${subIsEscaped ? it.sub : esc(it.sub).replace(/&lt;(\/?)i&gt;/g, "<$1i>")}</span></span>
    </li>`).join("");
}

async function improveAgent(i, btn) {
  const p = state.settings.provider;
  const a = state.blueprint.agents[i];
  btn.disabled = true; btn.textContent = "Improving…";
  try {
    const raw = await complete({
      provider: p, key: state.keys[p], model: currentModel(), system: REWRITE_AGENT_PROMPT,
      user: `Workflow: ${state.blueprint.workflowTitle}\nAgent: ${a.agentName}\nRole: ${a.role}\nInput: ${a.inputSource}\nOutput: ${a.outputDescription}\nTone: ${state.blueprint.meta?.tone}\nForm fields: ${state.blueprint.formFields.map(f => f.fieldName).join(", ")}\n\nCurrent prompt:\n${a.systemPrompt}`,
      maxTokens: 3000
    });
    a.systemPrompt = extractJson(raw).systemPrompt || a.systemPrompt;
    await persistBlueprint();
    renderBlueprint();
    toast("Prompt improved");
  } catch (e) {
    toast(`Couldn't improve: ${e.message}`, true);
    btn.disabled = false; btn.textContent = "✨ Improve with AI";
  }
}

// ---------------- Settings ----------------
function renderSettings() {
  $("#keyFields").innerHTML = Object.entries(PROVIDERS).map(([k, p]) => `
    <label for="key-${k}">${p.label}</label>
    <input id="key-${k}" data-key="${k}" type="password" placeholder="${p.keyHint}" value="${esc(state.keys[k] || "")}" autocomplete="off" spellcheck="false" />`).join("");
  $("#rememberKeys").checked = state.settings.rememberKeys;
  $("#maxTokens").value = state.settings.maxTokens;
  $("#themeSel").value = state.settings.theme;
  $("#ver").textContent = (typeof chrome !== "undefined" && chrome.runtime?.getManifest?.().version) || "dev";
}
function applyTheme() { document.documentElement.dataset.theme = state.settings.theme; }

let fileMode = "settings";
function exportSettings() {
  const data = { type: "flowprint-settings", version: 1, exportedAt: new Date().toISOString(), settings: state.settings };
  if ($("#exportKeys").checked) data.keys = state.keys;
  downloadBlob(JSON.stringify(data, null, 2), "flowprint-settings.json", "application/json");
  $("#settingsStatus").textContent = data.keys ? "Exported (includes API keys – keep this file private)." : "Exported (no API keys).";
  $("#settingsStatus").className = "status ok";
}
async function onFile(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const st = $("#settingsStatus");
  try {
    const data = JSON.parse(await file.text());
    if (fileMode === "settings") {
      if (data.type !== "flowprint-settings") throw new Error("Not a FlowPrint settings file");
      state.settings = { ...state.settings, ...data.settings };
      if (data.keys) { state.keys = { ...state.keys, ...data.keys }; await saveKeys(state.keys, state.settings.rememberKeys); }
      await saveSettings(state.settings);
      applyTheme(); renderSettings(); renderProviders(); updateTaskUI();
      st.textContent = `✓ Settings imported${data.keys ? " with API keys" : ""}.`;
    } else {
      const bp = parseBlueprint(JSON.stringify(data));
      if (bp.error || !bp.agents.length) throw new Error("Not a FlowPrint blueprint");
      bp.meta = data.meta; bp.checks = data.checks || { knowledge: [], publish: [] };
      state.blueprint = bp;
      await persistBlueprint();
      renderBlueprint();
      go("agents");
      toast("Blueprint loaded");
      return;
    }
    st.className = "status ok";
  } catch (err) {
    st.textContent = `✗ ${err.message}`;
    st.className = "status err";
  }
}

// ---------------- Wiring ----------------
function wire() {
  $("#stepTabs").addEventListener("click", e => { const b = e.target.closest("button[data-step]"); if (b && !b.disabled) go(b.dataset.step); });
  $("#btnBack").onclick = () => go(STEPS[Math.max(0, STEPS.indexOf(state.step) - 1)]);
  $("#btnNext").onclick = () => { const n = STEPS[STEPS.indexOf(state.step) + 1]; if (n) go(n); };
  $("#btnSettings").onclick = () => { renderSettings(); go("settings"); };
  $("#btnCloseSettings").onclick = () => go(state.prevStep);
  $("#btnPopout").onclick = () => {
    const ext = typeof chrome !== "undefined" && chrome.runtime?.getURL;
    const url = ext ? chrome.runtime.getURL("sidepanel.html?wide=1") : "sidepanel.html?wide=1";
    if (ext && chrome.tabs?.create) chrome.tabs.create({ url }); else window.open(url, "_blank");
  };

  // Setup
  $("#providerPills").addEventListener("click", async e => {
    const b = e.target.closest("[data-provider]");
    if (!b) return;
    state.settings.provider = b.dataset.provider;
    await saveSettings(state.settings);
    renderProviders(); updateTaskUI(); go(state.step);
    if (state.keys[state.settings.provider] && !state.settings.modelLists[state.settings.provider]?.length) refreshModels({ quiet: true });
  });
  $("#apiKey").addEventListener("change", async () => {
    state.keys[state.settings.provider] = $("#apiKey").value.trim();
    await saveKeys(state.keys, state.settings.rememberKeys);
    updateTaskUI(); go(state.step);
  });
  $("#btnTestKey").onclick = onTestKey;
  $("#btnRefreshModels").onclick = () => refreshModels();
  $("#model").onchange = async () => { state.settings.models[state.settings.provider] = $("#model").value; $("#customModel").value = ""; await saveSettings(state.settings); updateTaskUI(); };
  $("#customModel").onchange = async () => { state.settings.models[state.settings.provider] = currentModel(); await saveSettings(state.settings); updateTaskUI(); };

  // Task
  $("#presetPills").addEventListener("click", e => { const b = e.target.closest("[data-preset]"); if (b) applyPreset(b.dataset.preset); });
  $("#clearPreset").onclick = e => {
    e.preventDefault();
    state.draft = { task: "", tone: state.draft.tone, niche: "", outputs: [], preset: null };
    renderTaskStep(); persistDraft();
  };
  $("#taskText").addEventListener("input", onTaskInput);
  $("#tone").onchange = () => { state.draft.tone = $("#tone").value; persistDraft(); };
  $("#niche").oninput = () => { state.draft.niche = $("#niche").value; state.draft.nicheTouched = true; persistDraft(); };
  $("#outputTypes").addEventListener("change", () => {
    state.draft.outputs = $$("#outputTypes input:checked").map(c => c.value);
    state.draft.outputsTouched = true; persistDraft();
  });
  $("#btnGenerate").onclick = generate;
  $("#btnCancel").onclick = () => state.abort?.abort();

  // Blueprint edits
  $("#wfTitle").addEventListener("input", () => { state.blueprint.workflowTitle = $("#wfTitle").textContent.trim(); persistBlueprint(); });
  $("#wfDesc").addEventListener("input", () => { state.blueprint.workflowDescription = $("#wfDesc").textContent.trim(); persistBlueprint(); });
  $("#wfTitle").addEventListener("blur", renderBlueprint);
  $("#agentList").addEventListener("input", e => {
    if (e.target.matches(".agent-prompt")) { state.blueprint.agents[+e.target.dataset.i].systemPrompt = e.target.value; persistBlueprint(); }
  });
  $("#agentList").addEventListener("click", e => {
    const c = e.target.closest("[data-copy-agent]");
    if (c) return copy(state.blueprint.agents[+c.dataset.copyAgent].systemPrompt, "Prompt copied");
    const imp = e.target.closest("[data-improve-agent]");
    if (imp) improveAgent(+imp.dataset.improveAgent, imp);
  });
  document.addEventListener("change", e => {
    if (!e.target.matches("[data-check]")) return;
    const key = e.target.dataset.check, i = +e.target.dataset.i;
    const arr = state.blueprint.checks[key] = state.blueprint.checks[key] || [];
    if (e.target.checked) arr.push(i); else arr.splice(arr.indexOf(i), 1);
    e.target.closest("li").classList.toggle("checked", e.target.checked);
    persistBlueprint();
  });
  $("#btnCopyFields").onclick = () => copy(fieldsText(state.blueprint), "Field list copied");
  $("#btnCopyForm").onclick = () => copy(formCopyText(state.blueprint), "Form copy copied");

  // Export
  $("#btnPdf").onclick = () => { try { exportPdf(state.blueprint); } catch (e) { toast(`PDF failed: ${e.message}`, true); } };
  $("#btnTxt").onclick = () => exportTxt(state.blueprint);
  $("#btnJson").onclick = () => exportJson(state.blueprint);
  $("#btnCopyAll").onclick = () => copy(buildExportText(state.blueprint), "Blueprint copied");
  $("#btnStartOver").onclick = async () => {
    if (!confirm("Clear this blueprint and start a new one?")) return;
    state.blueprint = null;
    state.draft = { task: "", tone: "Conversational", niche: "", outputs: [], preset: null };
    await local.remove("blueprint"); await persistDraft();
    renderTaskStep(); go("task");
  };

  // Settings
  $("#keyFields").addEventListener("change", async e => {
    if (!e.target.dataset.key) return;
    state.keys[e.target.dataset.key] = e.target.value.trim();
    await saveKeys(state.keys, state.settings.rememberKeys);
    renderProviders(); updateTaskUI();
  });
  $("#rememberKeys").onchange = async () => {
    state.settings.rememberKeys = $("#rememberKeys").checked;
    await saveSettings(state.settings); await saveKeys(state.keys, state.settings.rememberKeys);
  };
  $("#maxTokens").onchange = async () => { state.settings.maxTokens = Math.max(1000, +$("#maxTokens").value || 8000); await saveSettings(state.settings); };
  $("#themeSel").onchange = async () => { state.settings.theme = $("#themeSel").value; applyTheme(); await saveSettings(state.settings); };
  $("#btnExportSettings").onclick = exportSettings;
  $("#btnImportSettings").onclick = () => { fileMode = "settings"; $("#fileInput").click(); };
  $("#btnLoadBlueprint").onclick = () => { fileMode = "blueprint"; $("#fileInput").click(); };
  $("#fileInput").onchange = onFile;
}

async function init() {
  if (new URLSearchParams(location.search).has("wide")) document.body.classList.add("wide");
  state.settings = await loadSettings();
  state.keys = await loadKeys(state.settings.rememberKeys);
  state.draft = { ...state.draft, ...((await local.get("draft")) || {}) };
  state.blueprint = (await local.get("blueprint")) || null;
  applyTheme();
  initTooltips();
  wire();
  renderProviders();
  renderTaskStep();
  renderBlueprint();
  const saved = await local.get("step");
  go(saved && canEnter(saved) && saved !== "settings" ? saved : (state.keys[state.settings.provider] ? "task" : "setup"));
  if (state.keys[state.settings.provider]) refreshModels({ quiet: true });
}

init();
