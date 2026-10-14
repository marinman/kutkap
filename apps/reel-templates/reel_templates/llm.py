"""Optional AI shot labeling (off by default). The app works fully without it."""

import json

import anthropic

MODEL = "claude-opus-5-5"
ROLES = ["hook", "setup", "demo", "proof", "payoff", "CTA"]

SYSTEM = (
    "You analyze the structure of short-form videos (Reels, TikToks, Shorts) so creators can reuse "
    "the structure with their own footage. Given the shot list, the timed transcript, and any "
    "on-screen text, label each shot's role, name the hook pattern in a few words "
    "(e.g. 'bold claim', 'question', 'before/after', 'POV', 'list teaser'), and write short "
    "placeholder copy for each text slot that keeps the original's structure but is generic enough "
    "to reuse. Keep notes brief and practical."
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
                "additionalProperties": False,
            },
        },
    },
    "required": ["hook_type", "reuse_notes", "shots"],
    "additionalProperties": False,
}


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


def label_template(template: dict, api_key: str) -> None:
    """Fills in roles, hook type, notes and placeholder copy in place. Failures are non-fatal."""
    if not template["shots"]:
        return
    client = anthropic.Anthropic(api_key=api_key)
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            messages=[{"role": "user", "content": _describe(template)}],
            output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        )
    except anthropic.AuthenticationError:
        template["reuse_notes"] = "AI labeling skipped: the Anthropic API key was rejected."
        return
    except anthropic.APIError as error:
        print(f"AI labeling failed: {error}")
        return

    if response.stop_reason == "refusal":
        return
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        labels = json.loads(text)
    except json.JSONDecodeError:
        return

    template["hook"]["type"] = labels["hook_type"]
    template["reuse_notes"] = labels["reuse_notes"]
    by_number = {shot["n"]: shot for shot in template["shots"]}
    for label in labels["shots"]:
        shot = by_number.get(label["n"])
        if not shot:
            continue
        shot["role"] = label["role"]
        shot["notes"] = label["notes"]
        placeholders = label["placeholder_text"]
        # Swap detected text for reusable placeholder copy, keeping the original alongside.
        for i, copy in enumerate(placeholders):
            if i < len(shot["on_screen_text"]):
                shot["on_screen_text"][i]["original"] = shot["on_screen_text"][i]["text"]
                shot["on_screen_text"][i]["text"] = copy
