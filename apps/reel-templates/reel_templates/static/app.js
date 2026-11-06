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
    ...(p.body_cuts_per_min != null
      ? [
          [p.hook_cuts_per_min, "Cuts / min in hook"],
          [p.body_cuts_per_min, "Cuts / min after"],
          [`${p.text_on_screen_pct}%`, "Text on screen"],
          [p.first_word_at != null ? `${p.first_word_at}s` : "—", "First word at"],
        ]
      : []),
  ];
  return `<div class="stats">${items.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>`;
}

const compact = (n) =>
  n == null ? "—" : Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
const seek = (t, label) =>
  t == null ? "" : `<button type="button" class="time" data-seek="${Number(t)}">${esc(label ?? clock(t))}</button>`;
const chips = (items, cls = "") => items.filter(Boolean).map((x) => `<span class="chip ${cls}">${esc(x)}</span>`).join("");

function performanceMarkup(template) {
  const s = template.stats;
  if (!s) {
    return `<div class="card muted">No view or like counts yet. Press <b>Refresh stats</b> to look them up.</div>`;
  }
  const d = template.stats_derived || {};
  const items = [
    [compact(s.views), "Views"],
    [compact(s.likes), "Likes"],
    [compact(s.comments), "Comments"],
    [compact(s.shares), "Shares"],
    [d.engagement_rate != null ? `${d.engagement_rate}%` : "—", "Engagement"],
    [compact(s.followers), "Followers"],
    [d.views_per_follower != null ? `${d.views_per_follower}×` : "—", "Views / follower"],
    [d.views_per_day != null ? compact(d.views_per_day) : "—", "Views / day"],
  ];
  const posted = s.posted_at ? new Date(s.posted_at).toLocaleDateString(undefined, { dateStyle: "medium" }) : "";
  return `
    <div class="stats">${items.map(([v, l]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join("")}</div>
    <div class="muted small">${[s.uploader && `by ${s.uploader}`, posted && `posted ${posted}`, s.sound && `sound: ${s.sound}`,
      `checked ${new Date(s.fetched_at).toLocaleString()}`].filter(Boolean).map(esc).join(" · ")}</div>
    ${s.hashtags?.length ? `<div>${chips(s.hashtags.slice(0, 12).map((h) => `#${h}`))}</div>` : ""}`;
}

function hookMarkup(template) {
  const h = template.hook;
  const ai = template.ai?.status === "ok" ? template.ai.hook : null;
  const strength = h.strength ?? null;
  return `
    <div class="card stack insight">
      <div class="row">
        <h3 class="grow">🪝 Hook <span class="muted">0:00–${clock(h.end ?? h.hook_window_s ?? 3)}</span></h3>
        ${strength != null ? `<span class="meter" title="Hook strength from measured signals"><i style="width:${strength}%"></i></span><b>${strength}</b>` : ""}
      </div>
      <blockquote>${esc(ai?.line || h.spoken || h.spoken_hook || "No spoken hook")}</blockquote>
      ${h.on_screen || h.first_3s_text ? `<div><span class="label">On screen</span> ${esc(h.on_screen || h.first_3s_text)}</div>` : ""}
      <div>${chips([ai?.pattern || h.type], "hook")}${chips((h.patterns || []).filter((p) => p !== ai?.pattern))}</div>
      ${ai?.why_it_works ? `<p>${esc(ai.why_it_works)}</p>` : ""}
      ${h.signals?.length ? `<ul class="signals">${h.signals.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

function loopsMarkup(template) {
  const aiLoops = template.ai?.status === "ok" ? template.ai.loops || [] : null;
  const found = template.loops?.open || [];
  const rewatch = template.loops?.rewatch;
  const rows = aiLoops?.length
    ? aiLoops.map(
        (l, i) => `<li>
          <div class="row"><b>Loop ${i + 1}</b>${seek(l.opens_at)}<span class="muted">opens</span>
            ${l.pays_off_at != null ? `→ ${seek(l.pays_off_at)}<span class="muted">pays off</span>` : `<span class="chip warn">never closed</span>`}</div>
          <div>“${esc(l.opening_line)}”</div>
          <div class="muted">Viewer waits for: ${esc(l.viewer_waits_for)}</div>
          ${l.payoff ? `<div class="muted">Payoff: ${esc(l.payoff)}</div>` : ""}
        </li>`,
      )
    : found.map(
        (l, i) => `<li>
          <div class="row"><b>Loop ${i + 1}</b><span class="chip">${esc(l.kind)}</span>${seek(l.opens_at)}<span class="muted">opens</span>
            ${l.closes_at != null ? `→ ${seek(l.closes_at)}<span class="muted">pays off after ${l.held_for_s}s</span>` : `<span class="chip warn">no clear payoff</span>`}</div>
          <div>“${esc(l.opening_line)}”</div>
          ${l.payoff_line ? `<div class="muted">Payoff: “${esc(l.payoff_line)}”</div>` : ""}
        </li>`,
      );
  return `
    <div class="card stack insight">
      <h3>🔁 Loops</h3>
      ${rows.length ? `<ol class="loops">${rows.join("")}</ol>` : `<div class="muted">No open loops found: nothing in the script makes the viewer wait for an answer.</div>`}
      ${
        rewatch
          ? `<div class="sub"><div class="row"><b>Rewatch loop</b><span class="chip ${rewatch.verdict === "no loop" ? "" : "hook"}">${esc(rewatch.verdict)}</span></div>
             ${template.ai?.rewatch_loop && template.ai.rewatch_loop.trim().toLowerCase() !== rewatch.verdict ? `<p>${esc(template.ai.rewatch_loop)}</p>` : ""}
             <ul class="signals">${(rewatch.reasons || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
          : ""
      }
    </div>`;
}

function ctaMarkup(template) {
  const cta = template.cta;
  if (!cta) return "";
  const ai = template.ai?.status === "ok" ? template.ai.cta : null;
  const p = cta.primary;
  const others = (cta.all || []).filter((c) => c !== p && !(p && c.text === p.text && c.type === p.type));
  return `
    <div class="card stack insight">
      <div class="row"><h3 class="grow">📣 Call to action</h3>${ai?.strength ? `<span class="chip ${ai.strength === "strong" ? "hook" : ai.strength === "none" || ai.strength === "weak" ? "warn" : ""}">${esc(ai.strength)}</span>` : ""}</div>
      ${
        p || ai?.line
          ? `<div class="row">${chips([ai?.ask || p?.type], "hook")}${p ? `<span class="muted">${esc(p.source)}</span>${seek(p.at)}` : ""}</div>
             <blockquote>${esc(ai?.line || p.text)}</blockquote>`
          : `<div class="muted">${esc(cta.note || "No call to action found.")}</div>`
      }
      ${ai?.suggestion ? `<div><span class="label">Try</span> ${esc(ai.suggestion)}</div>` : ""}
      ${others.length ? `<details><summary class="muted">${others.length} more</summary><ul class="signals">${others.map((c) => `<li>${esc(c.type)} · ${esc(c.source)} ${c.at != null ? clock(c.at) : ""}: ${esc(c.text)}</li>`).join("")}</ul></details>` : ""}
    </div>`;
}

function structureMarkup(template) {
  const beats = template.structure;
  if (!beats?.length) return "";
  const total = template.format.duration_s || 1;
  return `
    <div class="beats">${beats
      .map((b) => `<button type="button" class="beat beat-${esc(b.beat.toLowerCase())}" data-seek="${b.start}" style="flex:${Math.max(b.end - b.start, total * 0.04)}" title="${esc(b.beat)} ${clock(b.start)}–${clock(b.end)}"><b>${esc(b.beat)}</b><small>${clock(b.start)}</small></button>`)
      .join("")}</div>`;
}

function whyMarkup(template) {
  const ai = template.ai;
  if (!ai) return "";
  if (ai.status !== "ok") return `<div class="notice">${esc(ai.message)}</div>`;
  return `
    <div class="card stack insight">
      <h3>✨ Why it works <span class="muted small">${esc(ai.model)}, on this Mac</span></h3>
      <ul>${(ai.why_it_works || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      ${ai.what_to_copy ? `<div><span class="label">Copy this</span> ${esc(ai.what_to_copy)}</div>` : ""}
    </div>`;
}

async function runTemplateJob(path, button, status) {
  button.disabled = true;
  try {
    const { job_id } = await api(path, { method: "POST" });
    await pollJob(job_id, (job) => (status.innerHTML = progressMarkup(job)));
    return true;
  } catch (error) {
    status.innerHTML = `<div class="error">${esc(error.message)}</div>`;
    button.disabled = false;
    return false;
  }
}

async function renderAnalysis(id) {
  const template = await api(`/api/templates/${id}`);
  const isVideo = template.shots.length > 0;
  const isOld = !template.analyzed_at;
  view.innerHTML = `
    <div class="row" style="margin-bottom:16px">
      <div class="grow"><h1>${esc(template.title)}</h1><a class="muted" href="${esc(template.source_url)}" target="_blank" rel="noopener noreferrer">${esc(template.source_url)}</a></div>
      <button type="button" id="refresh-stats">Refresh stats</button>
      <button type="button" id="reanalyze">Re-analyze</button>
      <a class="button primary" href="#/template/${esc(id)}">Edit template →</a>
    </div>
    <div id="job-status"></div>
    ${isOld ? `<div class="notice">This was analyzed before the hook, loop and CTA breakdown existed. Press <b>Re-analyze</b> to get it.</div>` : ""}
    <div class="${isVideo ? "analysis" : ""}">
      ${isVideo ? `<video id="player" src="${fileUrl(template.source_file)}" controls playsinline></video>` : `<audio id="player" src="${fileUrl(template.source_file)}" controls style="width:100%"></audio>`}
      <div class="stack">
        <h2>Performance</h2>
        ${performanceMarkup(template)}
        ${template.structure ? `<h2>Structure</h2>${structureMarkup(template)}` : ""}
        <h2>Breakdown</h2>
        ${hookMarkup(template)}
        ${template.loops ? loopsMarkup(template) : ""}
        ${ctaMarkup(template)}
        ${whyMarkup(template)}
        <h2>Pacing</h2>
        ${statsMarkup(template)}
        ${
          isVideo
            ? `<h2>Shots</h2>
               <div class="timeline-bar">${template.shots.map((s) => `<div style="flex:${s.duration}" title="Shot ${s.n}: ${s.duration}s"></div>`).join("")}</div>
               <div class="strip" style="margin-top:10px">${template.shots
                 .map(
                   (s) => `<button class="frame" data-seek="${s.start}">
                      <img src="${fileUrl(s.keyframe)}" alt="Shot ${s.n}" loading="lazy" />
                      <small>#${s.n}${s.role ? ` · ${esc(s.role)}` : ""} · ${clock(s.start)} · ${s.duration}s</small>
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

  const status = view.querySelector("#job-status");
  view.querySelector("#reanalyze").addEventListener("click", async (event) => {
    if (await runTemplateJob(`/api/templates/${id}/reanalyze`, event.currentTarget, status)) renderAnalysis(id);
  });
  view.querySelector("#refresh-stats").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    status.innerHTML = `<div class="muted">Looking up the latest numbers…</div>`;
    try {
      await api(`/api/templates/${id}/stats`, { method: "POST" });
      renderAnalysis(id);
    } catch (error) {
      status.innerHTML = `<div class="error">${esc(error.message)}</div>`;
      button.disabled = false;
    }
  });
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
              ${t.views != null ? `<span class="chip">${esc(compact(t.views))} views</span>` : ""}
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
        <label class="row"><input type="checkbox" name="llm_enabled" ${settings.llm_enabled ? "checked" : ""} /> <b>AI breakdown</b> <span class="muted">(explains the hook, loops and CTA and labels shots; runs on your local Ollama, nothing leaves this computer, skipped if Ollama isn't running)</span></label>
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
