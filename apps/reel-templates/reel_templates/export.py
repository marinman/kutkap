"""Template export to Markdown and JSON."""

import json

EXPORT_EXCLUDED_KEYS = {"saved", "download_id"}


def to_json(template: dict) -> str:
    public = {k: v for k, v in template.items() if k not in EXPORT_EXCLUDED_KEYS}
    return json.dumps(public, indent=2, ensure_ascii=False)


def _clock(seconds: float) -> str:
    minutes, secs = divmod(seconds, 60)
    return f"{int(minutes)}:{secs:04.1f}"


def _num(value) -> str:
    return f"{value:,}" if isinstance(value, int) else "—"


def _breakdown(template: dict, stats: dict, ai: dict) -> list[str]:
    lines = []
    if stats:
        lines += [
            "## Performance",
            f"- Views: {_num(stats.get('views'))} · Likes: {_num(stats.get('likes'))} · "
            f"Comments: {_num(stats.get('comments'))} · Shares: {_num(stats.get('shares'))}",
            f"- Followers: {_num(stats.get('followers'))} · Posted: {(stats.get('posted_at') or '—')[:10]}",
            "",
        ]
    hook = template["hook"]
    if hook.get("signals") or ai.get("hook"):
        lines += ["## Hook breakdown", f"- Window: 0–{hook.get('end', '?')}s · Strength: {hook.get('strength', '—')}/100"]
        if ai.get("hook"):
            lines.append(f"- Why it works: {ai['hook'].get('why_it_works', '')}")
        lines += [f"- {signal}" for signal in hook.get("signals", [])] + [""]
    loops = (ai.get("loops") if ai else None) or (template.get("loops") or {}).get("open", [])
    if template.get("loops"):
        lines.append("## Loops")
        for i, loop in enumerate(loops, start=1):
            opens = loop.get("opens_at")
            closes = loop.get("pays_off_at", loop.get("closes_at"))
            lines.append(
                f"{i}. {_clock(opens) if opens is not None else '?'} “{loop.get('opening_line', '')}” → "
                + (f"pays off at {_clock(closes)}: {loop.get('payoff') or loop.get('payoff_line', '')}" if closes is not None else "never pays off")
            )
        if not loops:
            lines.append("- No open loops found.")
        rewatch = template["loops"].get("rewatch") or {}
        lines += [f"- Rewatch loop: {rewatch.get('verdict', '—')}. " + "; ".join(rewatch.get("reasons", [])), ""]
    cta = template.get("cta")
    if cta:
        primary = cta.get("primary") or {}
        ask = (ai.get("cta") or {}) if ai else {}
        lines += [
            "## Call to action",
            f"- {ask.get('ask') or primary.get('type') or 'None'}: {ask.get('line') or primary.get('text') or cta.get('note', '')}",
        ]
        if ask.get("suggestion"):
            lines.append(f"- Suggestion: {ask['suggestion']}")
        lines.append("")
    if ai.get("why_it_works"):
        lines += ["## Why it works"] + [f"- {reason}" for reason in ai["why_it_works"]] + [""]
    return lines


def to_markdown(template: dict) -> str:
    fmt = template["format"]
    hook = template["hook"]
    pacing = template["pacing"]
    audio = template["audio"]
    stats = template.get("stats") or {}
    ai = template.get("ai") if (template.get("ai") or {}).get("status") == "ok" else {}
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
        *_breakdown(template, stats, ai),
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
