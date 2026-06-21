import os
import anthropic
from session import SessionManager

_client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


async def update_memory(session_id: str, sessions: SessionManager):
    history = sessions.get_history(session_id)
    user_msgs = [m["content"] for m in history if m["role"] == "user"]
    if len(user_msgs) < 2:
        return

    msg = await _client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=32,
        system="Summarize this guitarist's tone preferences in 4 words max. Return only the keywords, comma-separated. Example: warm, dark, heavy reverb",
        messages=[{"role": "user", "content": "\n".join(user_msgs[-6:])}],
    )
    sessions.set_memory(session_id, msg.content[0].text.strip())
