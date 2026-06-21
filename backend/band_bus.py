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

AGENT_NAMES = {"VibeAgent", "CriticAgent", "ResearchAgent", "MemoryAgent", "FeedbackAgent"}

def _vibe_key() -> str:
    try:
        _, key = load_agent_config("vibe_agent")
        return key
    except Exception:
        return os.getenv("BAND_VIBE_API_KEY", "")


async def send_to_room(message: str, mention: str = "@VibeAgent"):
    room_id = os.getenv("BAND_ROOM_ID", "").strip()
    if not room_id:
        logger.warning("BAND_ROOM_ID not set — skipping Band send")
        return None
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"{BAND_REST}/chats/{room_id}/messages",
            headers={
                "Authorization": f"Bearer {_vibe_key()}",
                "Content-Type": "application/json",
            },
            json={"content": f"{mention} {message}"},
            timeout=10,
        )
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
                            msg    = payload.get("message", {})
                            sender = msg.get("sender", {}).get("name", "")
                            content = msg.get("content", "")
                            if sender in AGENT_NAMES:
                                await on_message({
                                    "agent":   sender,
                                    "content": content,
                                    "timestamp": msg.get("created_at"),
                                })
                    except Exception as e:
                        logger.error(f"Band message parse error: {e}")

        except Exception as e:
            logger.warning(f"Band WS disconnected ({e}), reconnecting in 3s…")
            await asyncio.sleep(3)
