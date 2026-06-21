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


# --- performance mode (feat/performance-mode) -----------------------------
# In-memory setlist store. NOTE: resets on server restart — fine for the demo.
import uuid
from typing import List

setlists: dict = {}


class Song(BaseModel):
    song_name: str
    vibe: str


class SetlistRequest(BaseModel):
    name: str
    esp_ip: str
    songs: List[Song]


@app.post("/setlist")
async def create_setlist(req: SetlistRequest):
    try:
        # Precompute every song's tone NOW so transitions are instant later.
        songs = []
        for s in req.songs:
            chain = await generate_preset(s.vibe)
            songs.append({"song_name": s.song_name, "vibe": s.vibe, "chain": chain})

        sid = uuid.uuid4().hex[:8]
        setlist = {
            "id": sid,
            "name": req.name,
            "esp_ip": req.esp_ip,
            "current": -1,
            "songs": songs,
        }
        setlists[sid] = setlist
        return setlist
    except Exception as e:
        return {"error": str(e)}


@app.get("/setlist/{sid}")
async def get_setlist(sid: str):
    try:
        setlist = setlists.get(sid)
        if setlist is None:
            return {"error": "setlist not found"}
        return setlist
    except Exception as e:
        return {"error": str(e)}


async def _go_to(sid: str, index: int):
    """Move to a song index, push its precomputed chain, return the active state."""
    setlist = setlists.get(sid)
    if setlist is None:
        return {"error": "setlist not found"}
    setlist["current"] = index
    song = setlist["songs"][index]
    pushed = await run_in_threadpool(push_to_pedal, song["chain"], setlist["esp_ip"])
    return {
        "current": index,
        "song_name": song["song_name"],
        "effects": song["chain"].get("effects", []),
        "pushed": pushed,
    }


@app.post("/setlist/{sid}/start")
async def start_setlist(sid: str):
    try:
        setlist = setlists.get(sid)
        if setlist is None:
            return {"error": "setlist not found"}
        if not setlist["songs"]:
            return {"error": "setlist is empty"}
        return await _go_to(sid, 0)
    except Exception as e:
        return {"error": str(e)}


@app.post("/setlist/{sid}/next")
async def next_song(sid: str):
    try:
        setlist = setlists.get(sid)
        if setlist is None:
            return {"error": "setlist not found"}
        last = len(setlist["songs"]) - 1
        if setlist["current"] >= last:
            return {"done": True}
        return await _go_to(sid, min(setlist["current"] + 1, last))
    except Exception as e:
        return {"error": str(e)}


@app.post("/setlist/{sid}/prev")
async def prev_song(sid: str):
    try:
        setlist = setlists.get(sid)
        if setlist is None:
            return {"error": "setlist not found"}
        return await _go_to(sid, max(setlist["current"] - 1, 0))
    except Exception as e:
        return {"error": str(e)}
