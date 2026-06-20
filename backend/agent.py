import os
import json
import re
import anthropic
from dotenv import load_dotenv

load_dotenv()

SYSTEM_PROMPT = """You are CalGPT, an expert guitar tone designer. When a user describes a guitar tone in plain language, translate it into a precise effect chain JSON.

Respond with ONLY valid JSON — no explanation, no markdown fences. Schema:

{
  "preset_name": "short descriptive name (max 30 chars)",
  "effects": []
}

Available effect types and parameter ranges:
- { "type": "overdrive", "drive": 0.0–1.0, "tone": 0.0–1.0, "mix": 0.0–1.0 }
- { "type": "chorus",    "rate_hz": 0.1–5.0, "depth": 0.0–1.0, "mix": 0.0–1.0 }
- { "type": "delay",     "time_ms": 50–2000, "feedback": 0.0–1.0, "mix": 0.0–1.0 }
- { "type": "reverb",    "size": 0.0–1.0, "damping": 0.0–1.0, "mix": 0.0–1.0 }

Rules:
1. Only include effects that contribute to the described tone — don't pad the chain.
2. When stacking, preserve this signal order: overdrive → chorus → delay → reverb.
3. Set values that accurately reflect the described intensity and character.
4. Return ONLY the JSON object. No other text whatsoever."""

_client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


async def generate_preset(vibe: str) -> dict:
    msg = await _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": vibe}],
    )
    text = msg.content[0].text.strip()
    # strip markdown fences in case Claude adds them anyway
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    return json.loads(text)
