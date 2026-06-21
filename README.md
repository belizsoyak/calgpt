# CalGPT (Guitar Pedal Technology)🎸

> Describe a guitar tone in plain language. Five AI agents research it, engineer it, critique it, and remember your preferences — all in real time.

The bigger vision: a studio session where a producer says *"give me early Clapton, but darker"* and the effects update automatically. No gear knowledge required.

---

## Multi-agent architecture (Band)

The CalGPT UI posts your message to a shared Band room. Five agents coordinate autonomously from there:

```
User message
    │
    ▼
research_agent   — identifies artist gear or translates descriptors into gear language
    │
    ▼
vibe_agent       — engineers the full JSON effect chain
    │
  ┌─┴─┐
  ▼   ▼
critic_agent    memory_agent
  │   └── logs tone keywords, sends profile back to vibe_agent
  │
  └── (if issue) → vibe_agent  "reduce reverb mix to 0.3"
       (if solid) → memory_agent  "log this"
```

`feedback_agent` activates on 👎 — diagnoses the chain and routes 3 quick fixes back to `vibe_agent`.

---

## Features

- **Studio mode** — type a tone or artist name, get an effect chain rendered as interactive stomp-box knobs
- **Performance mode** — build a setlist, precompute every song's tone, flip through with Prev/Next
- **Live audio** — run your guitar through the chain in the browser via Web Audio API
- **Hardware bridge** — ESP32 firmware receives the JSON chain over WiFi and runs the DSP on-device. Setlists export as CSV and load onto flash so tone switching works off a footswitch with no network needed mid-show. *(WiFi live-push didn't make it in time — the architecture is ready, the hardware-software connection needed more time.)*

---

## Stack

| Layer | Tech |
|---|---|
| Agent communication | [Band](https://app.band.ai) | Band Room: https://app.band.ai/chat/a6f18fd6-e45c-4f10-81d0-ab23fa52e646
| AI | Anthropic `claude-sonnet-4-6` |
| Backend | Python FastAPI + WebSocket |
| DSP / preview | Spotify `pedalboard` |
| Frontend | React + Vite + Tailwind CSS v4 |
| Live audio | Tone.js + Web Audio API |
| Hardware | ESP32 (C++ firmware) |

---

## Running locally

```bash
# backend
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # ANTHROPIC_API_KEY + BAND_* vars
uvicorn main:app --reload

# band agents (4 terminals)
python band_research_agent.py
python band_vibe_agent.py
python band_critic_agent.py
python band_memory_agent.py

# frontend
cd frontend && npm install && npm run dev
```

---

## Environment

```bash
ANTHROPIC_API_KEY=sk-ant-...
BAND_REST_URL=https://app.band.ai/
BAND_WS_URL=wss://app.band.ai/api/v1/socket/websocket
BAND_ROOM_ID=<your-room-uuid>
```

Agent credentials in `backend/agent_config.yaml` (gitignored):
```yaml
vibe_agent:
  agent_id: "..."
  api_key:  "band_a_..."
# research_agent, critic_agent, memory_agent, feedback_agent
```

---

## Effect schema

```json
{
  "preset_name": "Texas Crunch",
  "effects": [
    { "type": "overdrive", "drive": 0.6, "tone": 0.5, "mix": 0.9 },
    { "type": "delay",     "time_ms": 220, "feedback": 0.3, "mix": 0.25 },
    { "type": "reverb",    "size": 0.35, "damping": 0.5, "mix": 0.2 }
  ]
}
```
