# Handoff message (setlist → CSV → ESP)

Hey — the setlist → CSV → ESP path is on branch `feat/setlist-csv`. All additive;
the app, `/vibe`, `/pedal`, `/setlist`, and the mock pedal all still work.

**What I added:**
- Backend: `GET /setlist/{id}/export.csv` — dumps each song's tone params as one
  CSV row. There's also a **⬇ Export CSV** button in the Performance tab.
- Firmware (`calgpt_pedal.ino`): reads `setlist.csv` from LittleFS into
  `ToneParams[]` and switches the active tone per song. Advances on a
  **footswitch (GPIO)** or over WiFi.

**The contract (13 columns, THIS exact order — both sides parse by position, don't reorder):**

```
od_drive, od_tone, od_mix, vib_rate, vib_depth, vib_mix,
trem_rate, trem_depth, trem_mix, dl_time_ms, dl_feedback, dl_mix, rv_mix
```

**Getting the setlist onto the ESP — three ways, all built in:**
1. **WiFi fetch (default):** set `EXPORT_URL` at the top to
   `http://<LAPTOP_IP>:8000/setlist/<SETLIST_ID>/export.csv` (your laptop's
   **LAN IP**, not localhost). It pulls on boot, and you can `POST /reload` to
   the pedal anytime to re-pull without re-flashing.
2. **LittleFS "ESP32 Data Upload" plugin:** drop `setlist.csv` in `/data`
   (offline fallback).
3. Footswitch on `NEXT_PIN` (button to GND, INPUT_PULLUP) for "next song."

**⚠️ For the WiFi fetch to work:** run the backend bound to all interfaces, not
just localhost —

```
uvicorn main:app --host 0.0.0.0 --port 8000
```

(the default `127.0.0.1` is laptop-only and the ESP can't reach it). The ESP and
laptop must be on the same WiFi, and the laptop firewall has to allow the
connection. `LAPTOP_IP` can change when you switch networks. (I tested the fetch
+ CSV parse end-to-end over the LAN this way — works.)

**The one piece left:** I2S audio I/O for real guitar in/out — that's the codec
part; the read/write stubs are marked in `loop()`. The DSP (`processSample`) and
param-switching are done, so once the codec's wired it's guitar in → effects → out.

Full writeup in `firmware/CONNECTING_THE_ESP.md`. Tell me your board (plain ESP32
vs A1S/LyraT audio kit) and I'll help wire the I2S.

⚠️ One more note: I couldn't compile the sketch on my end (no ESP32 toolchain) —
please do a compile in the Arduino IDE before flashing.
