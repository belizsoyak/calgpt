import os
import json
import re
import anthropic
from dotenv import load_dotenv
from session import SessionManager

load_dotenv()

SYSTEM_PROMPT = """You are an expert guitar tone agent and effects engineer in a live studio session.

When a guitarist refines their tone, adjust the previous params — never start from scratch unless explicitly asked.
Respond like a real engineer: confident, brief, specific.

Return ONLY valid JSON — no markdown, no explanation:
{
  "message": "one sentence max, what you changed and why",
  "contract": {
    "preset_name": "short name",
    "effects": []
  }
}

Available effects:
- { "type": "overdrive", "drive": 0.0-1.0, "tone": 0.0-1.0, "mix": 0.0-1.0 }
- { "type": "chorus",    "rate_hz": 0.1-5.0, "depth": 0.0-1.0, "mix": 0.0-1.0 }
- { "type": "delay",     "time_ms": 50-2000, "feedback": 0.0-1.0, "mix": 0.0-1.0 }
- { "type": "reverb",    "size": 0.0-1.0, "damping": 0.0-1.0, "mix": 0.0-1.0 }

Signal order: overdrive → chorus → delay → reverb. Only include effects that serve the tone."""

_client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


async def run_vibe_agent(session_id: str, message: str, sessions: SessionManager) -> dict:
    sessions.add_to_history(session_id, "user", message)

    msg = await _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=sessions.get_history(session_id),
    )

    text = msg.content[0].text.strip()
    text = re.sub(r"^```[a-z]*\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    result = json.loads(text)

    sessions.add_to_history(session_id, "assistant", text)

    await sessions.send(session_id, {
        "type": "chain_update",
        "agent": "vibe",
        "message": result["message"],
        "contract": result["contract"],
    })

    return result
