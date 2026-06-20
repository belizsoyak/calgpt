from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent import generate_preset

app = FastAPI(title="CalGPT")

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
