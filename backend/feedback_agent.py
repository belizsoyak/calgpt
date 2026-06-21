import os
import json
import re
import anthropic
from session import SessionManager

_client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

SYSTEM_PROMPT = """You are CalGPT's Feedback Agent. When a guitarist rejects a tone, diagnose the most likely issue.

Analyze the effect chain params and return exactly 3 quick fix options as short button labels.

Rules:
- Each fix is 2-3 words max
- Each fix addresses a different aspect of the sound
- Base fixes on actual param values:
  reverb mix > 0.7  → "Less reverb"
  drive > 0.8       → "Soften drive"
  overdrive tone < 0.3 → "Brighten tone"
  delay mix > 0.6   → "Less delay"
  delay feedback > 0.75 → "Tighten delay"
  no overdrive      → "Add grit"
  no reverb         → "Add space"
  chorus mix > 0.6  → "Less chorus"

Return ONLY a JSON array, no explanation: ["Fix 1", "Fix 2", "Fix 3"]"""


async def get_quick_fixes(contract: dict, session_id: str, sessions: SessionManager) -> list[str]:
    rejections = sessions.get_rejections(session_id)
    context = f"Chain: {json.dumps(contract)}"
    if rejections:
        context += f"\nPrior rejections: {json.dumps([r['reason'] for r in rejections[-3:]])}"

    msg = await _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=64,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": context}],
    )
    text = msg.content[0].text.strip()
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    return json.loads(text)
