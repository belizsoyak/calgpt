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
