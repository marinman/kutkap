"""Template export to Markdown and JSON."""

import json

EXPORT_EXCLUDED_KEYS = {"saved", "download_id"}


def to_json(template: dict) -> str:
    public = {k: v for k, v in template.items() if k not in EXPORT_EXCLUDED_KEYS}
    return json.dumps(public, indent=2, ensure_ascii=False)


def _clock(seconds: float) -> str:
    minutes, secs = divmod(seconds, 60)
    return f"{int(minutes)}:{secs:04.1f}"


def to_markdown(template: dict) -> str:
    fmt = template["format"]
    hook = template["hook"]
    pacing = template["pacing"]
    audio = template["audio"]
    lines = [
        f"# {template['title'] or 'Untitled template'}",
        "",
        f"Source: {template['source_url']}",
        "",
        "## Format",
        f"- Duration: {fmt['duration_s']}s",
        f"- Aspect ratio: {fmt['aspect_ratio']} ({fmt['resolution']}, {fmt['fps']} fps)",
        "",
        "## Hook",
        f"- Type: {hook['type'] or '—'}",
        f"- On-screen text (first 3s): {hook['first_3s_text'] or '—'}",
        f"- Spoken hook: {hook['spoken_hook'] or '—'}",
        "",
        "## Pacing",
        f"- Shots: {pacing['shots']}",
        f"- Cuts per minute: {pacing['cuts_per_min']}",
        f"- Average shot: {pacing['avg_shot_s']}s",
        f"- Hook window: {pacing.get('hook_window_s', 0)}s",
        "",
    ]
    if template["shots"]:
        lines += ["## Shot list", "", "| # | Time | Length | Role | On-screen text | Notes |", "|---|---|---|---|---|---|"]
        for shot in template["shots"]:
            text = "; ".join(f"{b['text']} ({b['position']})" for b in shot.get("on_screen_text", []))
            lines.append(
                f"| {shot['n']} | {_clock(shot['start'])}–{_clock(shot['end'])} | {shot['duration']}s "
                f"| {shot.get('role') or ''} | {text.replace('|', '/')} | {(shot.get('notes') or '').replace('|', '/')} |"
            )
        lines.append("")
    lines += [
        "## Audio",
        f"- Type: {audio['type']}",
        "",
        audio["transcript"] or "_No speech detected._",
        "",
        "## Caption style",
        f"- Position: {template['caption_style']['position'] or '—'}",
        f"- Notes: {template['caption_style']['notes'] or '—'}",
        "",
        "## Reuse notes",
        template["reuse_notes"] or "—",
        "",
    ]
    return "\n".join(lines)
