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
  main.py       — FastAPI app, CORS, /health + /vibe + /pedal endpoints
  agent.py      — Claude call, system prompt, JSON parsing
  fx_engine.py  — pedalboard DSP (stubs if not installed)
  esp32_bridge.py — flatten a chain + push it to the ESP32 pedal over WiFi
  mock_pedal.py — local stand-in for the pedal (test the bridge w/o hardware)
firmware/
  calgpt_pedal.ino — ESP32 firmware: DSP chain + POST /params WiFi server
frontend/
  src/          — React app
```

## Hardware bridge

Push a generated tone to a physical ESP32 pedal.

### `POST /pedal`
```json
// request — esp_ip is host:port, NO http:// prefix
{ "vibe": "warm 70s blues with slapback delay", "esp_ip": "192.168.1.42:80" }

// response
{ "chain": { "preset_name": "...", "effects": [ ... ] }, "pushed": true }
```
`pushed` is `false` (never an error) if the pedal is unreachable.

### Test it without hardware

```bash
# terminal 1: backend
cd backend && uvicorn main:app --reload

# terminal 2: mock pedal
cd backend && python mock_pedal.py        # http://127.0.0.1:9000

# terminal 3: fire a call, then watch http://127.0.0.1:9000/ update
curl -X POST http://localhost:8000/pedal -H "Content-Type: application/json" \
  -d '{"vibe":"warm blues with slapback","esp_ip":"127.0.0.1:9000"}'
```

The mock pedal prints the flattened params (`od_*`, `vib_*`, `trem_*`, `dl_*`, `rv_mix`)
to its console and on its dashboard — that's the same payload the real firmware receives.
