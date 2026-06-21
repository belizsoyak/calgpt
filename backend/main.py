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


# --- setlist CSV export (feat/setlist-csv) ---------------------------------
# Shared contract with the ESP32 firmware: these 13 columns IN THIS EXACT ORDER.
# Both sides parse by position, so the order must match the export exactly.
import csv
import io
from fastapi import HTTPException
from esp32_bridge import chain_to_flat

FLAT_COLUMNS = [
    "od_drive", "od_tone", "od_mix",
    "vib_rate", "vib_depth", "vib_mix",
    "trem_rate", "trem_depth", "trem_mix",
    "dl_time_ms", "dl_feedback", "dl_mix",
    "rv_mix",
]


@app.get("/setlist/{sid}/export.csv")
def export_setlist_csv(sid: str):
    setlist = setlists.get(sid)
    if setlist is None:
        raise HTTPException(status_code=404, detail="setlist not found")

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["song"] + FLAT_COLUMNS)
    for song in setlist["songs"]:
        flat = chain_to_flat(song["chain"])
        writer.writerow([song["song_name"]] + [flat.get(col, 0.0) for col in FLAT_COLUMNS])

    filename = f"setlist_{sid}.csv"
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- audio preview (feat/preview-audio) -----------------------------------
# Render a chain over a synthesized guitar sample and return the processed WAV.
# No audio asset needed (sample is generated in-code) and no new dependency
# (numpy + pedalboard already ship with the backend). The board is built inline
# here with pedalboard's actual class names rather than via fx_engine.apply_chain.
import os
import tempfile
import numpy as np
from fastapi import Response
from pedalboard import Pedalboard, Distortion, Chorus, Delay, Reverb
from pedalboard.io import AudioFile

PREVIEW_SR = 44100


class PreviewRequest(BaseModel):
    preset_name: str | None = None
    effects: list = []


def _synth_guitar(sr: int = PREVIEW_SR) -> np.ndarray:
    """A short plucked 3-note riff so effects (drive/chorus/delay/reverb) are audible."""
    notes = [146.83, 196.00, 246.94]  # D3, G3, B3
    note_dur = 0.7
    audio = np.zeros(0, dtype=np.float32)
    for f in notes:
        t = np.linspace(0, note_dur, int(sr * note_dur), endpoint=False)
        env = np.exp(-4.0 * t)  # plucked decay
        # fundamental + a few harmonics for a richer, string-like timbre
        wave = (
            np.sin(2 * np.pi * f * t)
            + 0.5 * np.sin(2 * np.pi * 2 * f * t)
            + 0.25 * np.sin(2 * np.pi * 3 * f * t)
        )
        audio = np.concatenate([audio, (wave * env).astype(np.float32)])
    audio *= 0.3 / (np.max(np.abs(audio)) or 1.0)  # normalize headroom
    return audio


def _build_board(effects: list) -> Pedalboard:
    board = Pedalboard()
    for fx in effects:
        t = fx.get("type")
        if t == "overdrive":
            board.append(Distortion(drive_db=float(fx.get("drive", 0.0)) * 40))
        elif t == "chorus":
            board.append(Chorus(
                rate_hz=float(fx.get("rate_hz", 1.0)),
                depth=float(fx.get("depth", 0.0)),
                mix=float(fx.get("mix", 0.0)),
            ))
        elif t == "delay":
            board.append(Delay(
                delay_seconds=float(fx.get("time_ms", 0)) / 1000.0,
                feedback=float(fx.get("feedback", 0.0)),
                mix=float(fx.get("mix", 0.0)),
            ))
        elif t == "reverb":
            mix = float(fx.get("mix", 0.0))
            board.append(Reverb(
                room_size=float(fx.get("size", 0.0)),
                damping=float(fx.get("damping", 0.0)),
                wet_level=mix,
                dry_level=1.0 - mix,
            ))
    return board


def _render(effects: list) -> bytes:
    """Synthesize a sample, run the chain over it, return WAV bytes. Blocking — run in a thread."""
    audio = _synth_guitar()
    processed = _build_board(effects)(audio, PREVIEW_SR)
    if processed.ndim == 1:
        processed = processed.reshape(1, -1)

    fd, out_path = tempfile.mkstemp(prefix="calgpt_preview_", suffix=".wav")
    os.close(fd)
    try:
        with AudioFile(out_path, "w", PREVIEW_SR, processed.shape[0]) as f:
            f.write(processed)
        with open(out_path, "rb") as f:
            return f.read()
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)


@app.post("/preview")
async def preview(req: PreviewRequest):
    wav = await run_in_threadpool(_render, req.effects)
    return Response(content=wav, media_type="audio/wav")
