# CalGPT

An AI guitar tone agent — describe a tone in plain language, get a DSP effect chain back.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React + Vite + Tailwind (Vercel) |
| Backend | Python FastAPI |
| DSP | Spotify pedalboard |
| AI | Anthropic claude-sonnet-4-6 |

## Quick start

### Backend

```bash
cd backend
cp .env.example .env          # add your ANTHROPIC_API_KEY
pip install -r requirements.txt
uvicorn main:app --reload
```

Server runs at http://localhost:8000. Docs at http://localhost:8000/docs.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Dev server at http://localhost:5173.

## API

### `GET /health`
```json
{ "status": "ok" }
```

### `POST /vibe`
```json
// request
{ "vibe": "warm vintage blues with a hint of spring reverb" }

// response
{
  "preset_name": "Warm Vintage Blues",
  "effects": [
    { "type": "overdrive", "drive": 0.35, "tone": 0.4, "mix": 0.8 },
    { "type": "reverb", "size": 0.3, "damping": 0.6, "mix": 0.25 }
  ]
}
```

## Effect schema

| Effect | Parameters |
|--------|-----------|
| `overdrive` | `drive` 0–1, `tone` 0–1, `mix` 0–1 |
| `chorus` | `rate_hz` 0.1–5.0, `depth` 0–1, `mix` 0–1 |
| `delay` | `time_ms` 50–2000, `feedback` 0–1, `mix` 0–1 |
| `reverb` | `size` 0–1, `damping` 0–1, `mix` 0–1 |

## File map

```
backend/
  main.py       — FastAPI app, CORS, /health + /vibe endpoints
  agent.py      — Claude call, system prompt, JSON parsing
  fx_engine.py  — pedalboard DSP (stubs if not installed)
frontend/
  src/          — React app
```
