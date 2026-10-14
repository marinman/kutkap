"""Optional AI shot labeling with a local Ollama model (off by default).

The app works fully without it. Nothing leaves this computer.
"""

import json

import requests

ROLES = ["hook", "setup", "demo", "proof", "payoff", "CTA"]
REQUEST_TIMEOUT_SECONDS = 300

SYSTEM = (
    "You analyze the structure of short-form videos (Reels, TikToks, Shorts) so creators can reuse "
    "the structure with their own footage. Given the shot list, the timed transcript, and any "
    "on-screen text, label each shot's role, name the hook pattern in a few words "
    "(e.g. 'bold claim', 'question', 'before/after', 'POV', 'list teaser'), and write short "
    "placeholder copy for each shot's on-screen text that keeps the original's structure but is "
    "generic enough to reuse. Return one entry per shot, using the shot numbers you were given. "
    "Keep notes brief and practical."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "hook_type": {"type": "string"},
        "reuse_notes": {"type": "string"},
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
    "required": ["hook_type", "reuse_notes", "shots"],
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
            "on_screen_text": [b["text"] for b in s.get("on_screen_text", [])],
        }
        for s in template["shots"]
    ]
    return json.dumps(
        {
            "title": template["title"],
            "duration_s": template["format"]["duration_s"],
            "shots": shots,
            "transcript": template["audio"].get("segments", []),
        },
        ensure_ascii=False,
    )


def label_template(template: dict, base_url: str, model: str) -> None:
    """Fills in roles, hook type, notes and placeholder copy in place. Failures are non-fatal."""
    if not template["shots"]:
        return
    try:
        response = requests.post(
            f"{base_url}/api/chat",
            json={
                "model": model,
                "stream": False,
                # Reasoning models (qwen3, gpt-oss) are much faster without a thinking pass here.
                "think": False,
                "format": SCHEMA,
                "options": {"temperature": 0.2},
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
        template["reuse_notes"] = "AI labeling skipped: Ollama isn't running."
        return
    except (requests.RequestException, KeyError, json.JSONDecodeError) as error:
        print(f"AI labeling failed: {error}")
        return

    template["hook"]["type"] = str(labels.get("hook_type", ""))
    template["reuse_notes"] = str(labels.get("reuse_notes", ""))
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
                shot["on_screen_text"][i]["original"] = shot["on_screen_text"][i]["text"]
                shot["on_screen_text"][i]["text"] = str(copy)
