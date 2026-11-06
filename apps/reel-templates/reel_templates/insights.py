"""Breakdown of why a reel works: performance stats, hook, open loops, rewatch loop, CTA, structure.

Everything here is local heuristics; llm.py can refine it with a local Ollama model.
"""

import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HOOK_MAX_SECONDS = 6.0
HOOK_MIN_SECONDS = 1.5
CTA_TAIL_FRACTION = 0.35

# Performance -----------------------------------------------------------------------

def stats_from_info(info: dict) -> dict:
    """Public numbers yt-dlp reports for a post. Missing values stay None (Instagram hides some)."""
    posted = None
    if info.get("timestamp"):
        posted = datetime.fromtimestamp(info["timestamp"], tz=timezone.utc).isoformat()
    elif info.get("upload_date"):
        posted = datetime.strptime(info["upload_date"], "%Y%m%d").replace(tzinfo=timezone.utc).isoformat()
    description = info.get("description") or ""
    hashtags = sorted({tag.lower() for tag in re.findall(r"#(\w+)", description)})
    return {
        "views": info.get("view_count"),
        "likes": info.get("like_count"),
        "comments": info.get("comment_count"),
        "shares": info.get("repost_count"),
        "followers": info.get("channel_follower_count"),
        "uploader": info.get("uploader") or info.get("channel") or "",
        "posted_at": posted,
        "description": description[:2000],
        "hashtags": hashtags or [t.lower() for t in (info.get("tags") or [])][:30],
        "sound": " – ".join(x for x in (info.get("track"), info.get("artist")) if x) or None,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def derived_stats(stats: dict | None) -> dict:
    """Engagement ratios people compare reels by."""
    if not stats:
        return {}
    views, likes = stats.get("views"), stats.get("likes")
    comments, shares, followers = stats.get("comments"), stats.get("shares"), stats.get("followers")
    out: dict = {}
    if views:
        interactions = sum(v for v in (likes, comments, shares) if v)
        if interactions:
            out["engagement_rate"] = round(interactions / views * 100, 2)
        if likes:
            out["like_rate"] = round(likes / views * 100, 2)
        if comments:
            out["comments_per_1k_views"] = round(comments / views * 1000, 2)
        if followers:
            ratio = views / followers
            out["views_per_follower"] = round(ratio, 1 if ratio >= 10 else 2)
    if stats.get("posted_at"):
        age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(stats["posted_at"])).total_seconds() / 86400
        out["days_since_post"] = max(0, round(age_days, 1))
        if views and age_days >= 1:
            out["views_per_day"] = round(views / age_days)
    return out


# Text helpers ------------------------------------------------------------------------

def _words(segments: list[dict]) -> list[dict]:
    return [w for s in segments for w in s.get("words", []) if w.get("word")]


def _sentences(segments: list[dict]) -> list[dict]:
    """Splits word-timed speech into sentences at . ! ? (falls back to Whisper segments)."""
    words = _words(segments)
    if not words:
        return [{"start": s["start"], "end": s["end"], "text": s["text"]} for s in segments]
    sentences, current = [], []
    for word in words:
        current.append(word)
        if re.search(r"[.!?]['\"”’)]*$", word["word"]):
            sentences.append(current)
            current = []
    if current:
        sentences.append(current)
    return [{"start": ws[0]["start"], "end": ws[-1]["end"], "text": " ".join(w["word"] for w in ws)}
            for ws in sentences]


# Hook ----------------------------------------------------------------------------------

HOOK_PATTERNS = [
    ("question", r"\?|^(what|why|how|who|when|where|did you|do you|have you|are you|is it|can you|would you)\b"),
    ("list / number", r"\b(\d+|three|four|five|six|seven|ten)\s+(ways|things|tips|reasons|mistakes|steps|secrets|signs|hacks|rules)\b|\bnumber (one|1)\b"),
    ("warning / negative", r"\b(stop|don'?t|never|quit|avoid|mistake|wrong|worst|nobody|no one)\b"),
    ("bold claim", r"\b(best|greatest|only|#1|number one|ever|guaranteed|always|literally|the most|changed my life)\b"),
    ("curiosity gap", r"\b(secret|here'?s why|here'?s how|the reason|what happens|you won'?t believe|nobody tells you|i found|turns out|wait (for|till|until)|watch (this|till|until))\b"),
    ("direct address", r"\b(you|your|you'?re)\b"),
    ("POV / relatable", r"\b(pov|when you|me when|that moment|if you'?re|tell me you)\b"),
    ("how-to / tutorial", r"\b(how to|here'?s how|tutorial|step by step|let me show you|i'?ll show you)\b"),
    ("story", r"^(so|when i|i was|yesterday|last (week|year|night)|this is the story|story ?time)\b"),
    ("contrarian", r"\b(unpopular opinion|hot take|actually|myth|lie|overrated|everyone is wrong|they lied)\b"),
    ("result first", r"\b(i (made|lost|gained|grew|got|went from)|from \$?\d|\$\d+|in \d+ (days|weeks|months))\b"),
]


def match_patterns(text: str, patterns=HOOK_PATTERNS) -> list[str]:
    lowered = text.lower().strip()
    return [name for name, pattern in patterns if re.search(pattern, lowered)]


def analyze_hook(segments: list[dict], shots: list[dict], hook_text_blocks: list[str], duration: float) -> dict:
    sentences = _sentences(segments)
    words = _words(segments)
    first_word_at = words[0]["start"] if words else None

    # The hook is the opening line: the first sentence (two if the first is a fragment), capped.
    end = None
    spoken = ""
    if sentences:
        picked = [sentences[0]]
        if picked[0]["end"] < HOOK_MIN_SECONDS and len(sentences) > 1 and sentences[1]["end"] <= HOOK_MAX_SECONDS:
            picked.append(sentences[1])
        end = min(picked[-1]["end"], HOOK_MAX_SECONDS)
        spoken = " ".join(w["word"] for w in words if w["start"] < end) if words else picked[0]["text"]
    if end is None:
        end = min(shots[0]["end"], HOOK_MAX_SECONDS) if shots else min(duration, 3.0)
    end = round(max(end, min(duration, HOOK_MIN_SECONDS)), 2)

    on_screen = " / ".join(dict.fromkeys(t for t in hook_text_blocks if t))
    patterns = match_patterns(f"{spoken} {on_screen}")
    cuts_in_hook = sum(1 for s in shots[1:] if s["start"] < end)

    signals, score = [], 40
    if first_word_at is not None:
        if first_word_at <= 0.5:
            score += 15
            signals.append(f"Talks immediately ({first_word_at:.1f}s in)")
        elif first_word_at > 1.5:
            score -= 10
            signals.append(f"Silent for the first {first_word_at:.1f}s")
    if on_screen:
        score += 15
        signals.append("Text on screen in the first seconds (works with sound off)")
    else:
        signals.append("No on-screen text in the hook")
    if cuts_in_hook:
        score += min(15, 8 * cuts_in_hook)
        signals.append(f"{cuts_in_hook} cut{'s' if cuts_in_hook != 1 else ''} inside the hook")
    elif shots and shots[0]["duration"] > 4:
        signals.append(f"Opening shot holds for {shots[0]['duration']:.1f}s with no cut")
    strong = [p for p in patterns if p != "direct address"]
    if strong:
        score += min(20, 10 * len(strong))
        signals.append("Pattern: " + ", ".join(strong))
    if "direct address" in patterns:
        score += 5
        signals.append("Speaks to the viewer (“you”)")

    return {
        "start": 0.0,
        "end": end,
        "spoken": spoken.strip(),
        "on_screen": on_screen,
        "patterns": patterns,
        "first_word_at": first_word_at,
        "cuts_in_hook": cuts_in_hook,
        "strength": max(0, min(100, score)),
        "signals": signals,
    }


# Open loops ------------------------------------------------------------------------------

LOOP_OPENERS = [
    ("tease", r"\b(wait (for|till|until)|watch (till|until) the end|stick around|stay (till|until)|by the end|at the end|keep watching|you'?ll see)\b"),
    ("promise", r"\b(i'?ll show you|let me show you|here'?s (how|why|what)|i'?m going to (show|tell)|the secret|the trick|the reason)\b"),
    ("question", r"\?\s*$"),
    ("list setup", r"\b(\d+|three|four|five|seven|ten) (ways|things|tips|reasons|mistakes|steps|secrets|signs|hacks|rules)\b"),
    ("twist", r"\b(but (then|here'?s|what)|plot twist|until|turns out|little did|what (i|they|you) didn'?t)\b"),
    ("cliffhanger", r"\b(guess what|you won'?t believe|what happened next|and then)\b"),
]
LOOP_CLOSERS = r"\b(that'?s (why|how|the)|the answer|turns out|here it is|so the|finally|the result|and that'?s|because|which means|last(ly)?|number (\d+|one|two|three|four|five))\b"


def find_open_loops(segments: list[dict], duration: float) -> list[dict]:
    """Moments that open a curiosity gap, and the first later line that looks like the payoff."""
    sentences = _sentences(segments)
    loops = []
    for index, sentence in enumerate(sentences):
        kinds = match_patterns(sentence["text"], LOOP_OPENERS)
        if not kinds:
            continue
        # A rhetorical question answered in the same breath isn't much of a loop.
        if kinds == ["question"] and index + 1 < len(sentences) and sentences[index + 1]["start"] - sentence["end"] < 0.3 \
                and sentence["end"] > duration * 0.85:
            continue
        payoff = next(
            (s for s in sentences[index + 1:] if re.search(LOOP_CLOSERS, s["text"].lower())),
            None,
        )
        loops.append({
            "kind": kinds[0],
            "opens_at": sentence["start"],
            "opening_line": sentence["text"],
            "closes_at": payoff["start"] if payoff else None,
            "payoff_line": payoff["text"] if payoff else "",
            "held_for_s": round(payoff["start"] - sentence["start"], 1) if payoff else None,
        })
    return loops[:8]


# Rewatch loop -----------------------------------------------------------------------------

def _gray_frame(path: Path, at: float) -> np.ndarray | None:
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{max(at, 0):.3f}", "-i", str(path),
         "-frames:v", "1", "-vf", "scale=48:48,format=gray", "-f", "rawvideo", "-"],
        capture_output=True, check=False,
    )
    if len(result.stdout) != 48 * 48:
        return None
    return np.frombuffer(result.stdout, dtype=np.uint8).astype(np.float32)


def analyze_rewatch_loop(path: Path, duration: float, segments: list[dict], has_video: bool) -> dict:
    """Does the ending flow straight back into the start, so viewers watch it twice?"""
    reasons, score = [], 0
    similarity = None
    if has_video and duration > 1:
        first, last = _gray_frame(path, 0.05), _gray_frame(path, duration - 0.15)
        if first is not None and last is not None:
            similarity = round(1 - float(np.abs(first - last).mean()) / 255, 2)
            if similarity >= 0.9:
                score += 45
                reasons.append(f"Last frame matches the first ({int(similarity * 100)}% similar)")
            elif similarity >= 0.8:
                score += 20
                reasons.append(f"Last frame looks close to the first ({int(similarity * 100)}% similar)")
            else:
                reasons.append(f"Ending looks different from the opening ({int(similarity * 100)}% similar)")

    words = _words(segments)
    if words:
        last_word = words[-1]
        tail_gap = duration - last_word["end"]
        if tail_gap < 0.4:
            score += 25
            reasons.append("Speech runs right up to the last frame")
        else:
            reasons.append(f"{tail_gap:.1f}s of silence after the last word")
        if not re.search(r"[.!?]['\"”’)]*$", last_word["word"]):
            score += 20
            reasons.append("Ends mid-sentence, which pulls viewers back to the start")
        opening = " ".join(w["word"] for w in words[:6]).lower()
        if re.match(r"^(and|so|because|but|that'?s|which)\b", opening):
            score += 10
            reasons.append("Opens with a connector word, like it continues from the ending")

    verdict = "seamless loop" if score >= 60 else "partial loop" if score >= 30 else "no loop"
    return {"verdict": verdict, "score": min(100, score), "frame_similarity": similarity, "reasons": reasons}


# CTA ---------------------------------------------------------------------------------------

CTA_PATTERNS = [
    ("follow", r"\b(follow (me|for|us|along)|hit follow|make sure (you'?re|to) follow)\b"),
    ("comment", r"\b(comment|let me know|tell me (in|below)|drop (a|an|your)|type ['\"“]?\w+)\b"),
    ("save", r"\b(save (this|it|for later)|bookmark)\b"),
    ("share", r"\b(share (this|it|with)|send (this|it) to|tag (a|someone|your))\b"),
    ("link in bio", r"\b(link in (my |the )?bio|link below|in my bio|check (the|my) bio)\b"),
    ("subscribe", r"\b(subscribe|sub to|turn on (the )?notifications)\b"),
    ("like", r"\b(like (this|the video)|smash (that|the) like|double tap|give it a like)\b"),
    ("DM", r"\b(dm me|message me|send me a (dm|message))\b"),
    ("buy / sign up", r"\b(sign up|join (my|the|now)|buy|shop|order|download|book (a|your)|grab (yours|it)|use code|get (yours|it) (now|today|here))\b"),
    ("watch more", r"\b(part (2|two)|watch (part|my|the next)|full video|more on my page|next video)\b"),
]


def find_ctas(segments: list[dict], shots: list[dict], tail_text_blocks: list[str], description: str,
              duration: float) -> dict:
    found = []
    for sentence in _sentences(segments):
        for kind in match_patterns(sentence["text"], CTA_PATTERNS):
            found.append({"type": kind, "source": "spoken", "at": sentence["start"], "text": sentence["text"]})
    seen_text = set()
    for shot in shots:
        for block in shot.get("on_screen_text", []):
            text = block.get("original") or block["text"]
            for kind in match_patterns(text, CTA_PATTERNS):
                if (kind, text) not in seen_text:
                    seen_text.add((kind, text))
                    found.append({"type": kind, "source": "on-screen", "at": shot["start"], "text": text})
    for text in tail_text_blocks:
        for kind in match_patterns(text, CTA_PATTERNS):
            if (kind, text) not in seen_text:
                seen_text.add((kind, text))
                found.append({"type": kind, "source": "on-screen", "at": round(max(duration - 1, 0), 2), "text": text})
    for line in description.splitlines():
        for kind in match_patterns(line, CTA_PATTERNS):
            found.append({"type": kind, "source": "post caption", "at": None, "text": line.strip()[:200]})

    # The main ask is the last one in the video's closing stretch; otherwise the post caption's.
    tail_start = duration * (1 - CTA_TAIL_FRACTION)
    in_video = sorted((c for c in found if c["at"] is not None), key=lambda c: c["at"])
    primary = next((c for c in reversed(in_video) if c["at"] >= tail_start), None) \
        or (in_video[-1] if in_video else None) \
        or next((c for c in found if c["source"] == "post caption"), None)
    return {
        "primary": primary,
        "all": found[:12],
        "has_cta": bool(found),
        "note": "" if found else "No call to action found: it doesn't ask viewers to follow, comment, save, share or click.",
    }


# Structure ---------------------------------------------------------------------------------

def build_structure(hook: dict, loops: list[dict], cta: dict, duration: float) -> list[dict]:
    """A beat sheet: hook → body (→ payoff) → CTA, with times."""
    beats = [{"beat": "hook", "start": 0.0, "end": hook["end"]}]
    cta_at = (cta.get("primary") or {}).get("at")
    cta_start = cta_at if cta_at is not None and cta_at > hook["end"] else None
    payoff_at = max((l["closes_at"] for l in loops if l.get("closes_at")), default=None)
    body_end = cta_start or duration
    if payoff_at and hook["end"] < payoff_at < body_end:
        beats.append({"beat": "body", "start": hook["end"], "end": payoff_at})
        beats.append({"beat": "payoff", "start": payoff_at, "end": body_end})
    elif body_end > hook["end"]:
        beats.append({"beat": "body", "start": hook["end"], "end": body_end})
    if cta_start is not None:
        beats.append({"beat": "CTA", "start": cta_start, "end": duration})
    return [{**b, "start": round(b["start"], 2), "end": round(b["end"], 2)} for b in beats]


def retention_signals(shots: list[dict], segments: list[dict], hook: dict, duration: float) -> dict:
    """Pacing inside the hook vs the rest, and how much of the video has text on screen."""
    hook_cuts = hook["cuts_in_hook"]
    rest_cuts = max(len(shots) - 1 - hook_cuts, 0)
    rest_len = max(duration - hook["end"], 0.1)
    with_text = sum(s["duration"] for s in shots if s.get("on_screen_text"))
    longest = max(shots, key=lambda s: s["duration"]) if shots else None
    return {
        "hook_cuts_per_min": round(hook_cuts / max(hook["end"], 0.1) * 60, 1),
        "body_cuts_per_min": round(rest_cuts / rest_len * 60, 1),
        "text_on_screen_pct": round(with_text / duration * 100) if duration and shots else 0,
        "longest_shot": {"n": longest["n"], "start": longest["start"], "duration": longest["duration"]} if longest else None,
        "first_word_at": hook["first_word_at"],
    }
