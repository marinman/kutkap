// Reel Template Maker UI. Plain ES modules, no build step.
const view = document.getElementById("view");
const KUTKAP_URL = "http://localhost:3517/projects";

// --- helpers -----------------------------------------------------------------

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fileUrl = (relative) => (relative ? `/files/${relative.split("/").map(encodeURIComponent).join("/")}` : "");

const clock = (seconds) => {
  const s = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail ?? {};
    const error = new Error(typeof detail === "string" ? detail : detail.message || "Something went wrong.");
    error.status = response.status;
    error.detail = detail;
    throw error;
  }
  return data;
}

function toast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3000);
}

async function pollJob(jobId, onUpdate) {
  for (;;) {
    const job = await api(`/api/jobs/${jobId}`);
    onUpdate(job);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error);
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
}

function progressMarkup(job) {
  const extras = [job.speed, job.eta && `ETA ${job.eta}`].filter(Boolean).join(" · ");
  return `
    <div class="stack">
      <div class="row"><span class="grow">${esc(job.message)}</span><span class="muted">${Math.round(job.progress)}%${extras ? " · " + esc(extras) : ""}</span></div>
      <div class="progress"><div style="width:${job.progress}%"></div></div>
    </div>`;
}

// --- Home ------------------------------------------------------------------------

async function renderHome() {
  view.innerHTML = `
    <h1>Turn a reel into a template</h1>
    <p class="muted">Paste an Instagram, TikTok, or YouTube link. Everything is downloaded and analyzed on this computer.</p>
    <form class="card stack" id="download-form">
      <div class="row">
        <input class="grow" type="url" id="url" placeholder="https://www.instagram.com/reel/…" required autocomplete="off" />
        <button type="button" id="paste">Paste</button>
      </div>
      <div class="row">
        <div class="toggle" role="group" aria-label="Format">
          <button type="button" data-format="video" aria-pressed="true">Video</button>
          <button type="button" data-format="audio" aria-pressed="false">Audio only</button>
        </div>
        <span class="grow"></span>
        <button class="primary" type="submit">Download</button>
      </div>
      <div id="download-status"></div>
    </form>
    <h2>Recent downloads</h2>
    <div class="list" id="downloads"><div class="muted">Loading…</div></div>`;

  let format = "video";
  view.querySelectorAll("[data-format]").forEach((button) =>
    button.addEventListener("click", () => {
      format = button.dataset.format;
      view.querySelectorAll("[data-format]").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
    }),
  );

  view.querySelector("#paste").addEventListener("click", async () => {
    try {
      view.querySelector("#url").value = (await navigator.clipboard.readText()).trim();
    } catch {
      toast("Couldn't read the clipboard. Paste with ⌘V instead.");
    }
  });

  const status = view.querySelector("#download-status");
  view.querySelector("#download-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;
    status.innerHTML = "";
    try {
      const { job_id } = await api("/api/downloads", { method: "POST", body: { url: view.querySelector("#url").value, format } });
      const result = await pollJob(job_id, (job) => (status.innerHTML = progressMarkup(job)));
      status.innerHTML = `<div class="notice">Downloaded. Press <b>Analyze</b> below to build the template.</div>`;
      view.querySelector("#url").value = "";
      await loadDownloads(result.download_id);
    } catch (error) {
      const detail = error.detail || {};
      const link = detail.template_id
        ? ` <a href="#/template/${esc(detail.template_id)}">Open the existing template →</a>`
        : detail.download_id
          ? ` It's in your recent downloads below.`
          : "";
      status.innerHTML = `<div class="error">${esc(error.message)}${link}</div>`;
    } finally {
      submit.disabled = false;
    }
  });

  await loadDownloads();
}

async function loadDownloads(highlightId) {
  const container = view.querySelector("#downloads");
  if (!container) return;
  const downloads = await api("/api/downloads");
  if (!downloads.length) {
    container.innerHTML = `<div class="empty">No downloads yet.</div>`;
    return;
  }
  container.innerHTML = downloads
    .map(
      (d) => `
      <div class="list-item" ${d.id === highlightId ? 'style="border-color:var(--accent)"' : ""}>
        ${d.thumbnail ? `<img src="${esc(d.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : `<img alt="" />`}
        <div class="grow">
          <div class="title">${esc(d.title)}</div>
          <div class="muted">${esc(d.uploader)} · ${d.format === "audio" ? "Audio" : "Video"}${d.duration_s ? ` · ${Math.round(d.duration_s)}s` : ""}</div>
          <div class="analyze-status" data-id="${esc(d.id)}"></div>
        </div>
        ${
          d.template_id
            ? `<a class="button" href="#/analysis/${esc(d.template_id)}">View analysis</a>`
            : `<button class="primary" data-analyze="${esc(d.id)}">Analyze</button>`
        }
      </div>`,
    )
    .join("");

  container.querySelectorAll("[data-analyze]").forEach((button) =>
    button.addEventListener("click", () => runAnalysis(button.dataset.analyze, button)),
  );
}

async function runAnalysis(downloadId, button, confirmLong = false) {
  const status = view.querySelector(`.analyze-status[data-id="${CSS.escape(downloadId)}"]`);
  button.disabled = true;
  try {
    const { job_id } = await api(`/api/downloads/${downloadId}/analyze`, { method: "POST", body: { confirm_long: confirmLong } });
    const result = await pollJob(job_id, (job) => (status.innerHTML = progressMarkup(job)));
    location.hash = `#/analysis/${result.template_id}`;
  } catch (error) {
    if (error.status === 412 && error.detail?.needs_confirmation) {
      button.disabled = false;
      if (confirm(error.message)) return runAnalysis(downloadId, button, true);
      return;
    }
    status.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    button.disabled = false;
  }
}

// --- Analysis --------------------------------------------------------------------

function statsMarkup(template) {
  const p = template.pacing;
  const f = template.format;
  const items = [
    [`${f.duration_s}s`, "Duration"],
    [f.aspect_ratio || "—", f.resolution || "Aspect ratio"],
    [p.shots, "Shots"],
    [p.cuts_per_min, "Cuts / min"],
    [`${p.avg_shot_s}s`, "Avg shot"],
    [`${p.hook_window_s ?? 0}s`, "Hook window"],
    [p.words_per_min || "—", "Words / min"],
    [template.audio.type, "Audio"],
  ];
  return `<div class="stats">${items.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>`;
}

async function renderAnalysis(id) {
  const template = await api(`/api/templates/${id}`);
  const isVideo = template.shots.length > 0;
  view.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div class="grow"><h1>${esc(template.title)}</h1><a class="muted" href="${esc(template.source_url)}" target="_blank" rel="noopener noreferrer">${esc(template.source_url)}</a></div>
      <a class="button primary" href="#/template/${esc(id)}">Edit template →</a>
    </div>
    <div class="${isVideo ? "analysis" : ""}">
      ${isVideo ? `<video id="player" src="${fileUrl(template.source_file)}" controls playsinline></video>` : `<audio id="player" src="${fileUrl(template.source_file)}" controls style="width:100%"></audio>`}
      <div>
        ${statsMarkup(template)}
        ${
          isVideo
            ? `<h2>Shots</h2>
               <div class="timeline-bar">${template.shots.map((s) => `<div style="flex:${s.duration}" title="Shot ${s.n}: ${s.duration}s"></div>`).join("")}</div>
               <div class="strip" style="margin-top:10px">${template.shots
                 .map(
                   (s) => `<button class="frame" data-seek="${s.start}">
                      <img src="${fileUrl(s.keyframe)}" alt="Shot ${s.n}" loading="lazy" />
                      <small>#${s.n} · ${clock(s.start)} · ${s.duration}s</small>
                    </button>`,
                 )
                 .join("")}</div>`
            : ""
        }
        <h2>Transcript</h2>
        <div class="card transcript">${
          template.audio.segments?.length
            ? template.audio.segments.map((seg) => `<p><time data-seek="${seg.start}">${clock(seg.start)}</time>${esc(seg.text)}</p>`).join("")
            : `<span class="muted">No speech detected, so this is treated as a music track.</span>`
        }</div>
      </div>
    </div>`;

  const player = view.querySelector("#player");
  view.querySelectorAll("[data-seek]").forEach((el) =>
    el.addEventListener("click", () => {
      player.currentTime = Number(el.dataset.seek) + 0.01;
      player.play();
    }),
  );
}

// --- Template --------------------------------------------------------------------

const ROLES = ["", "hook", "setup", "demo", "proof", "payoff", "CTA"];
const POSITIONS = ["top", "middle", "bottom"].flatMap((v) => ["left", "center", "right"].map((h) => `${v}-${h}`));

function input(name, value, label, type = "text") {
  return `<label class="field"><span>${esc(label)}</span><input type="${type}" data-path="${esc(name)}" value="${esc(value)}" /></label>`;
}
function textarea(name, value, label) {
  return `<label class="field"><span>${esc(label)}</span><textarea data-path="${esc(name)}">${esc(value)}</textarea></label>`;
}

async function renderTemplate(id) {
  const template = await api(`/api/templates/${id}`);
  const shotsMarkup = template.shots
    .map(
      (shot, i) => `
      <div class="shot-editor">
        <img src="${fileUrl(shot.keyframe)}" alt="Shot ${shot.n}" loading="lazy" />
        <div class="stack">
          <div class="row"><b>Shot ${shot.n}</b><span class="muted">${clock(shot.start)}–${clock(shot.end)} · ${shot.duration}s</span></div>
          <div class="grid-2">
            <label class="field"><span>Role</span><select data-path="shots.${i}.role">${ROLES.map((r) => `<option ${r === shot.role ? "selected" : ""} value="${r}">${r || "—"}</option>`).join("")}</select></label>
            ${input(`shots.${i}.notes`, shot.notes, "Notes")}
          </div>
          <div class="stack text-slots" data-shot="${i}">
            ${(shot.on_screen_text || []).map((block, j) => textSlot(i, j, block)).join("")}
          </div>
          <div><button type="button" data-add-text="${i}">+ Text slot</button></div>
        </div>
      </div>`,
    )
    .join("");

  view.innerHTML = `
    <form id="template-form" class="stack">
      <div class="row">
        <div class="grow"><h1>Template</h1><span class="muted">${template.saved ? "Saved in your library" : "Draft: not in your library yet"}</span></div>
        <a class="button" href="#/analysis/${esc(id)}">Analysis</a>
        <a class="button" href="/api/templates/${esc(id)}/export.md">Export Markdown</a>
        <a class="button" href="/api/templates/${esc(id)}/export.json">Export JSON</a>
        <button class="primary" type="submit">${template.saved ? "Save changes" : "Save to library"}</button>
      </div>
      <div class="card stack">
        ${input("title", template.title, "Title")}
        <div class="grid-2">
          ${input("hook.type", template.hook.type, "Hook type (e.g. question, bold claim, before/after)")}
          ${input("hook.spoken_hook", template.hook.spoken_hook, "Spoken hook (first 3s)")}
        </div>
        ${input("hook.first_3s_text", template.hook.first_3s_text, "On-screen text in the first 3s")}
        ${statsMarkup(template)}
      </div>
      ${template.shots.length ? `<h2>Shots</h2><div class="card">${shotsMarkup}</div>` : ""}
      <h2>Audio</h2>
      <div class="card stack">
        <label class="field"><span>Type</span><select data-path="audio.type">${["voice", "music", "both"].map((t) => `<option ${t === template.audio.type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
        ${textarea("audio.transcript", template.audio.transcript, "Transcript")}
      </div>
      <h2>Caption style & reuse</h2>
      <div class="card stack">
        <div class="grid-2">
          ${input("caption_style.position", template.caption_style.position, "Caption position")}
          ${input("caption_style.notes", template.caption_style.notes, "Caption notes")}
        </div>
        ${textarea("reuse_notes", template.reuse_notes, "Reuse notes")}
      </div>
      <div class="row"><span class="grow"></span><button type="button" class="danger" id="delete">Delete template</button></div>
    </form>`;

  view.querySelectorAll("[data-add-text]").forEach((button) =>
    button.addEventListener("click", () => {
      const shotIndex = Number(button.dataset.addText);
      const slots = view.querySelector(`.text-slots[data-shot="${shotIndex}"]`);
      slots.insertAdjacentHTML("beforeend", textSlot(shotIndex, slots.children.length, { text: "", position: "bottom-center" }));
    }),
  );
  view.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-slot]");
    if (remove) remove.closest(".text-slot").remove();
  });

  view.querySelector("#template-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const updated = collectTemplate(template);
    updated.saved = true;
    await api(`/api/templates/${id}`, { method: "PUT", body: updated });
    toast("Saved to your library");
    renderTemplate(id);
  });

  view.querySelector("#delete").addEventListener("click", async () => {
    if (!confirm("Delete this template? The downloaded video stays in your downloads folder.")) return;
    await api(`/api/templates/${id}`, { method: "DELETE" });
    location.hash = "#/library";
  });
}

function textSlot(shotIndex, slotIndex, block) {
  return `
    <div class="row text-slot" data-shot="${shotIndex}">
      <input class="grow" type="text" data-slot-text value="${esc(block.text)}" placeholder="On-screen text" />
      <select data-slot-position style="width:160px">${POSITIONS.map((p) => `<option ${p === block.position ? "selected" : ""}>${p}</option>`).join("")}</select>
      <button type="button" data-remove-slot aria-label="Remove text slot">✕</button>
    </div>`;
}

function collectTemplate(original) {
  const result = structuredClone(original);
  view.querySelectorAll("[data-path]").forEach((field) => {
    const keys = field.dataset.path.split(".");
    let target = result;
    keys.slice(0, -1).forEach((key) => (target = target[key]));
    target[keys.at(-1)] = field.value;
  });
  result.shots.forEach((shot, i) => {
    shot.on_screen_text = [...view.querySelectorAll(`.text-slot[data-shot="${i}"]`)]
      .map((row) => ({ text: row.querySelector("[data-slot-text]").value.trim(), position: row.querySelector("[data-slot-position]").value }))
      .filter((block) => block.text);
  });
  return result;
}

// --- Library ---------------------------------------------------------------------

async function renderLibrary() {
  view.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div class="grow"><h1>Library</h1><span class="muted">Use these in the Kutkap editor's Templates tab.</span></div>
      <a class="button" href="${KUTKAP_URL}" target="_blank" rel="noopener">Open Kutkap editor</a>
    </div>
    <input type="search" id="search" placeholder="Search by hook type or keyword…" />
    <div class="library" id="templates" style="margin-top:16px"></div>`;

  const list = view.querySelector("#templates");
  const load = async (query = "") => {
    const templates = await api(`/api/templates?q=${encodeURIComponent(query)}`);
    list.innerHTML = templates.length
      ? templates
          .map(
            (t) => `
          <a class="tpl" href="#/template/${esc(t.id)}">
            <div class="thumbs">${t.keyframes.slice(0, 4).map((k) => `<img src="${fileUrl(k)}" alt="" loading="lazy" />`).join("")}</div>
            <div class="body">
              <div class="title">${esc(t.title)}</div>
              ${t.hook_type ? `<span class="chip hook">${esc(t.hook_type)}</span>` : ""}
              <span class="chip">${esc(t.format.duration_s)}s</span>
              <span class="chip">${esc(t.pacing.shots)} shots</span>
              <span class="chip">${esc(t.pacing.cuts_per_min)} cuts/min</span>
              <span class="chip">${esc(t.audio_type)}</span>
            </div>
          </a>`,
          )
          .join("")
      : `<div class="empty">${query ? "No templates match that search." : "No saved templates yet. Download a reel to get started."}</div>`;
  };
  let timer;
  view.querySelector("#search").addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => load(event.target.value), 200);
  });
  await load();
}

// --- Settings --------------------------------------------------------------------

async function renderSettings() {
  const settings = await api("/api/settings");
  const browsers = ["", "chrome", "safari", "firefox", "brave", "edge", "arc"];
  const models = ["tiny", "base", "small", "medium", "large-v3-turbo"];
  view.innerHTML = `
    <h1>Settings</h1>
    <form id="settings-form" class="stack" style="margin-top:16px">
      <div class="card stack">
        <label class="field"><span>Use cookies from this browser (lets you download posts you can see while logged in)</span>
          <select name="cookies_browser">${browsers.map((b) => `<option value="${b}" ${b === settings.cookies_browser ? "selected" : ""}>${b || "Off"}</option>`).join("")}</select>
        </label>
        <div class="grid-2">
          <label class="field"><span>Reel analysis transcription model</span>
            <select name="whisper_model">${models.map((m) => `<option ${m === settings.whisper_model ? "selected" : ""}>${m}</option>`).join("")}</select></label>
          <label class="field"><span>Kutkap caption model (bigger = more accurate, slower)</span>
            <select name="caption_model">${models.map((m) => `<option ${m === settings.caption_model ? "selected" : ""}>${m}</option>`).join("")}</select></label>
        </div>
      </div>
      <div class="card stack">
        <label class="row"><input type="checkbox" name="llm_enabled" ${settings.llm_enabled ? "checked" : ""} /> <b>AI shot labeling</b> <span class="muted">(optional, off by default; runs on your local Ollama, nothing leaves this computer)</span></label>
        <div class="grid-2">
          <label class="field"><span>Ollama model</span><select name="ollama_model" id="ollama-model"><option>${esc(settings.ollama_model)}</option></select></label>
          <label class="field"><span>Ollama address</span><input type="text" name="ollama_url" value="${esc(settings.ollama_url)}" /></label>
        </div>
        <div id="ollama-status" class="muted"></div>
      </div>
      <div class="row"><span class="grow"></span><button class="primary" type="submit">Save settings</button></div>
    </form>`;

  try {
    const { models } = await api("/api/ollama/models");
    const select = view.querySelector("#ollama-model");
    const choices = models.includes(settings.ollama_model) ? models : [settings.ollama_model, ...models];
    select.innerHTML = choices.map((m) => `<option ${m === settings.ollama_model ? "selected" : ""}>${esc(m)}</option>`).join("");
    if (!models.length) view.querySelector("#ollama-status").textContent = "No chat models installed. Run: ollama pull qwen3:8b";
  } catch (error) {
    view.querySelector("#ollama-status").textContent = error.message;
  }

  view.querySelector("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await api("/api/settings", {
      method: "PUT",
      body: {
        cookies_browser: form.get("cookies_browser"),
        whisper_model: form.get("whisper_model"),
        caption_model: form.get("caption_model"),
        llm_enabled: form.get("llm_enabled") === "on",
        ollama_model: form.get("ollama_model"),
        ollama_url: form.get("ollama_url").trim(),
      },
    });
    toast("Settings saved");
  });
}

// --- router ----------------------------------------------------------------------

const routes = [
  [/^#\/analysis\/([\w-]+)$/, renderAnalysis, "home"],
  [/^#\/template\/([\w-]+)$/, renderTemplate, "library"],
  [/^#\/library$/, renderLibrary, "library"],
  [/^#\/settings$/, renderSettings, "settings"],
  [/^(#\/?)?$/, renderHome, "home"],
];

async function route() {
  const hash = location.hash;
  const [, handler, nav] = routes.find(([pattern]) => pattern.test(hash)) ?? routes.at(-1);
  const match = hash.match(routes.find(([p]) => p.test(hash))?.[0] ?? /$/);
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
  try {
    await handler(match?.[1]);
  } catch (error) {
    view.innerHTML = `<div class="error">${esc(error.message)}</div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
