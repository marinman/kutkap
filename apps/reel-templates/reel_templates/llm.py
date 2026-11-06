"""AI breakdown (hook, loops, CTA, why it works) and shot labeling with a local Ollama model.

The app works fully without it. Nothing leaves this computer.
"""

import json
import re

import requests

ROLES = ["hook", "setup", "demo", "proof", "payoff", "CTA"]
HOOK_PATTERNS = {
    "bold claim": "a confident or extreme statement (best, greatest, only, never)",
    "question": "asks the viewer something they want answered",
    "result first": "shows or states the outcome/transformation before how it happened",
    "list teaser": "promises a number of tips, steps or things",
    "curiosity gap": "teases something without revealing it (the secret, wait for it, here's why)",
    "story opener": "drops the viewer into a moment or anecdote (so I was..., here we are...)",
    "POV / relatable": "a situation the viewer recognizes from their own life",
    "contrarian take": "goes against common belief (unpopular opinion, everyone is wrong)",
    "warning": "tells the viewer to stop or avoid something",
    "how-to": "promises to teach a specific skill",
    "visual surprise": "an unexpected image or action carries the hook more than the words",
    "challenge": "dares or calls out the viewer or someone else",
}
REQUEST_TIMEOUT_SECONDS = 300

SYSTEM = (
    "You are a short-form video strategist. You break down Reels, TikToks and Shorts so a creator "
    "can understand exactly why a video holds attention and reuse its structure with their own footage. "
    "You get measured data: performance stats, the shot list with on-screen text, the timed transcript, "
    "and heuristic findings for the hook, open loops, rewatch loop and call to action. Treat the "
    "heuristics as hints, not facts: confirm or correct them from the transcript. "
    "HOOK: quote the exact hook line, pick its pattern from this list: "
    + "; ".join(f"'{name}' = {meaning}" for name, meaning in HOOK_PATTERNS.items())
    + ". Then explain in one or two sentences why it "
    "stops the scroll. LOOPS: list each open loop (a question, promise or tease that makes the viewer wait "
    "for an answer): quote the line that opens it, its time, what the viewer is waiting to find out, and "
    "where and how it pays off (or say it never does). Say whether the ending loops back into the start. "
    "CTA: name what the video asks viewers to do, quote it, give its time, and rate it weak, ok or strong; "
    "if there is none, say so and suggest one that fits. Then give 3-5 concrete reasons it works, and "
    "what to copy. Label each shot's role and write short reusable placeholder copy for each shot's "
    "on-screen text. Only use times that appear in the data. Be brief, specific and practical."
)

TIME = {"type": ["number", "null"]}
SCHEMA = {
    "type": "object",
    "properties": {
        "hook": {
            "type": "object",
            "properties": {
                "line": {"type": "string"},
                "pattern": {"type": "string", "enum": list(HOOK_PATTERNS)},
                "why_it_works": {"type": "string"},
            },
            "required": ["line", "pattern", "why_it_works"],
        },
        "loops": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "opens_at": TIME,
                    "opening_line": {"type": "string"},
                    "viewer_waits_for": {"type": "string"},
                    "pays_off_at": TIME,
                    "payoff": {"type": "string"},
                },
                "required": ["opens_at", "opening_line", "viewer_waits_for", "pays_off_at", "payoff"],
            },
        },
        "rewatch_loop": {"type": "string"},
        "cta": {
            "type": "object",
            "properties": {
                "ask": {"type": "string"},
                "line": {"type": "string"},
                "at": TIME,
                "strength": {"type": "string", "enum": ["none", "weak", "ok", "strong"]},
                "suggestion": {"type": "string"},
            },
            "required": ["ask", "line", "at", "strength", "suggestion"],
        },
        "why_it_works": {"type": "array", "items": {"type": "string"}},
        "what_to_copy": {"type": "string"},
        "shots": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "role": {"type": "string", "enum": ROLES},
                    "notes": {"type": "string"},
                    "placeholder_text": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["n", "role", "notes", "placeholder_text"],
            },
        },
    },
    "required": ["hook", "loops", "rewatch_loop", "cta", "why_it_works", "what_to_copy", "shots"],
}


class OllamaUnavailable(Exception):
    pass


def list_models(base_url: str) -> list[str]:
    try:
        response = requests.get(f"{base_url}/api/tags", timeout=3)
        response.raise_for_status()
    except requests.RequestException as error:
        raise OllamaUnavailable("Ollama isn't running. Start the Ollama app and try again.") from error
    names = [model["name"] for model in response.json().get("models", [])]
    # Embedding models can't chat.
    return sorted(name for name in names if "embed" not in name)


def _describe(template: dict) -> str:
    shots = [
        {
            "n": s["n"],
            "start": s["start"],
            "end": s["end"],
            "on_screen_text": [b.get("original") or b["text"] for b in s.get("on_screen_text", [])],
        }
        for s in template["shots"]
    ]
    stats = template.get("stats") or {}
    hook = template["hook"]
    return json.dumps(
        {
            "title": template["title"],
            "duration_s": template["format"]["duration_s"],
            "performance": {k: stats.get(k) for k in ("views", "likes", "comments", "shares", "followers", "posted_at")},
            "post_caption": (stats.get("description") or "")[:600],
            "shots": shots,
            "transcript": template["audio"].get("segments", []),
            "heuristics": {
                "hook": {k: hook.get(k) for k in ("end", "spoken", "on_screen", "patterns", "signals")},
                "open_loops": template.get("loops", {}).get("open", []),
                "rewatch_loop": template.get("loops", {}).get("rewatch", {}),
                "cta": template.get("cta", {}),
            },
        },
        ensure_ascii=False,
    )


def _plain(text) -> str:
    """Models like to add list numbers and **bold**; the UI does its own formatting."""
    text = re.sub(r"^\s*(\d+[.)]|[-*•])\s+", "", str(text or ""))
    return text.replace("**", "").replace("__", "").strip()


def label_template(template: dict, base_url: str, model: str) -> None:
    """Adds the AI breakdown, hook type, shot roles and placeholder copy in place. Failures are non-fatal."""
    try:
        response = requests.post(
            f"{base_url}/api/chat",
            json={
                "model": model,
                "stream": False,
                # Reasoning models (qwen3, gpt-oss) are much faster without a thinking pass here.
                "think": False,
                "format": SCHEMA,
                "options": {"temperature": 0.2, "num_ctx": 16384, "num_predict": 2500},
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": _describe(template)},
                ],
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        labels = json.loads(response.json()["message"]["content"])
    except requests.ConnectionError:
        template["ai"] = {"status": "unavailable", "message": "Ollama isn't running, so there's no written breakdown. Start the Ollama app and press Re-analyze."}
        return
    except (requests.RequestException, KeyError, json.JSONDecodeError) as error:
        print(f"AI breakdown failed: {error}")
        template["ai"] = {"status": "failed", "message": "The AI breakdown failed. Press Re-analyze to try again."}
        return

    labels["why_it_works"] = [_plain(x) for x in labels.get("why_it_works") or [] if _plain(x)]
    labels["what_to_copy"] = _plain(labels.get("what_to_copy", ""))
    cta = labels.get("cta") or {}
    if not str(cta.get("line", "")).strip():
        # Nothing quoted means there is no CTA; a time or strength would be made up.
        labels["cta"] = {**cta, "line": "", "at": None, "strength": "none", "ask": "None"}
    template["ai"] = {
        "status": "ok",
        "model": model,
        **{k: labels.get(k) for k in ("hook", "loops", "rewatch_loop", "cta", "why_it_works", "what_to_copy")},
    }
    pattern = str((labels.get("hook") or {}).get("pattern", "")).strip()
    if pattern:
        template["hook"]["type"] = pattern
    if not template.get("reuse_notes"):
        template["reuse_notes"] = str(labels.get("what_to_copy", ""))
    by_number = {shot["n"]: shot for shot in template["shots"]}
    for label in labels.get("shots", []):
        shot = by_number.get(label.get("n"))
        if not shot:
            continue
        if label.get("role") in ROLES:
            shot["role"] = label["role"]
        shot["notes"] = str(label.get("notes", ""))
        # Swap detected text for reusable placeholder copy, keeping the original alongside.
        for i, copy in enumerate(label.get("placeholder_text", [])):
            if i < len(shot["on_screen_text"]):
                block = shot["on_screen_text"][i]
                block.setdefault("original", block["text"])
                block["text"] = str(copy)
