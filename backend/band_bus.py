import asyncio
import json
import logging
import os
import httpx
import websockets
from band.config import load_agent_config

logger = logging.getLogger(__name__)

BAND_REST = "https://app.band.ai/api/v1/agent"
BAND_WS   = "wss://app.band.ai/api/v1/socket/websocket"


def _vibe_creds() -> tuple[str, str]:
    try:
        agent_id, key = load_agent_config("vibe_agent")
        return agent_id, key
    except Exception:
        return "", os.getenv("BAND_VIBE_API_KEY", "")


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
    uri = f"{BAND_WS}?api_key={_vibe_key()}&vsn=2.0.0"
    while True:
        try:
            async with websockets.connect(uri) as ws:
                # Join the chat room Phoenix channel
                await ws.send(json.dumps(
                    ["1", "1", f"chat_room:{room_id}", "phx_join", {}]
                ))

                async def heartbeat():
                    while True:
                        await asyncio.sleep(30)
                        await ws.send(json.dumps(
                            ["1", "hb", "phoenix", "heartbeat", {}]
                        ))

                asyncio.create_task(heartbeat())

                async for raw in ws:
                    try:
                        data = json.loads(raw)
                        event   = data[3] if len(data) > 3 else None
                        payload = data[4] if len(data) > 4 else {}

                        if event == "message_created":
                            # Payload is flat — fields are directly at root level
                            sender_name = payload.get("sender_name") or ""
                            sender_type = payload.get("sender_type", "")
                            content     = payload.get("content", "")
                            if content and sender_type == "agent":
                                await on_message({
                                    "agent":   sender_name,
                                    "content": content,
                                    "timestamp": payload.get("inserted_at"),
                                })
                    except Exception as e:
                        logger.error(f"Band message parse error: {e}")

        except Exception as e:
            logger.warning(f"Band WS disconnected ({e}), reconnecting in 3s…")
            await asyncio.sleep(3)
