import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent import generate_preset
from session import SessionManager
from vibe_agent import run_vibe_agent
from critic_agent import run_critic_agent

app = FastAPI(title="CalGPT")
sessions = SessionManager()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class VibeRequest(BaseModel):
    vibe: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/vibe")
async def vibe(req: VibeRequest):
    return await generate_preset(req.vibe)


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await sessions.connect(session_id, websocket)
    try:
        while True:
            data = await websocket.receive_json()
            message = data.get("message", "").strip()
            if not message:
                continue
            result = await run_vibe_agent(session_id, message, sessions)
            asyncio.create_task(
                run_critic_agent(session_id, result["contract"], sessions)
            )
    except WebSocketDisconnect:
        sessions.disconnect(session_id)


# --- hardware bridge (feat/hardware-bridge) -------------------------------
from fastapi.concurrency import run_in_threadpool
from esp32_bridge import push_to_pedal


class PedalRequest(BaseModel):
    vibe: str
    esp_ip: str


@app.post("/pedal")
async def pedal(req: PedalRequest):
    chain = await generate_preset(req.vibe)
    pushed = await run_in_threadpool(push_to_pedal, chain, req.esp_ip)
    return {"chain": chain, "pushed": pushed}
