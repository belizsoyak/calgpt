import asyncio
import json
import logging
import os
import httpx
import websockets

try:
    from band.config import load_agent_config
except ImportError:  # band SDK is optional — features gated behind BAND_ROOM_ID
    load_agent_config = None

logger = logging.getLogger(__name__)

BAND_REST = "https://app.band.ai/api/v1/agent"
BAND_WS   = "wss://app.band.ai/api/v1/socket/websocket"


def _vibe_creds() -> tuple[str, str]:
    try:
        agent_id, key = load_agent_config("vibe_agent")
        return agent_id, key
    except Exception:
        return "", os.getenv("BAND_VIBE_API_KEY", "")


def _listener_key() -> str:
    """Use feedback_agent key for listening — keeps it separate from the vibe_agent terminal."""
    try:
        _, key = load_agent_config("feedback_agent")
        return key
    except Exception:
        return _vibe_creds()[1]


def _research_creds() -> tuple[str, str]:
    try:
        agent_id, key = load_agent_config("research_agent")
        return agent_id, key
    except Exception:
        return "", ""


async def send_to_room(message: str):
    """Post a message to the Band room as the vibe_agent, mentioning research_agent to kick off the chain."""
    room_id = os.getenv("BAND_ROOM_ID", "").strip()
    if not room_id:
        logger.warning("BAND_ROOM_ID not set — skipping Band send")
        return None

    vibe_id, vibe_key = _vibe_creds()
    research_id, _ = _research_creds()

    if not research_id:
        logger.warning("research_agent ID not found — skipping Band send")
        return None

    body = {
        "message": {
            "content": f"@research_agent {message}",
            "mentions": [
                {
                    "id": research_id,
                    "handle": "belizsoyak/research-agent",
                    "name": "research_agent",
                }
            ],
        }
    }

    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BAND_REST}/chats/{room_id}/messages",
            headers={"X-API-Key": vibe_key, "Content-Type": "application/json"},
            json=body,
            timeout=10,
        )
        logger.info(f"Band send response: {res.status_code} {res.text[:200]}")
        return res.json()


async def listen_for_responses(room_id: str, on_message):
    """Poll Band REST API for new agent messages — avoids WS key conflicts with running terminals."""
    _, key = _vibe_creds()
    last_seen_id: str | None = None

    while True:
        try:
            async with httpx.AsyncClient() as client:
                res = await client.get(
                    f"{BAND_REST}/chats/{room_id}/messages",
                    headers={"X-API-Key": key},
                    params={"page": 1, "page_size": 20},
                    timeout=10,
                )
                if res.status_code != 200:
                    logger.warning(f"Band poll error: {res.status_code} {res.text[:100]}")
                    await asyncio.sleep(3)
                    continue

                data = res.json()
                messages = data.get("data", [])

                # Process newest-first, find where we left off
                new_messages = []
                for msg in messages:
                    msg_id = msg.get("id")
                    if msg_id == last_seen_id:
                        break
                    sender_type = msg.get("sender_type", "")
                    content = msg.get("content", "")
                    if content and sender_type.lower() == "agent":
                        new_messages.append(msg)

                # Forward in chronological order (reverse since API returns newest first)
                for msg in reversed(new_messages):
                    await on_message({
                        "agent":   msg.get("sender_name") or "agent",
                        "content": msg.get("content", ""),
                        "timestamp": msg.get("inserted_at"),
                    })

                if messages:
                    last_seen_id = messages[0].get("id")

        except Exception as e:
            logger.warning(f"Band poll error: {e}")

        await asyncio.sleep(2)
