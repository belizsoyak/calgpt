# Connecting the ESP32 pedal

Handoff notes for taking CalGPT from the software demo to a real pedal.

## What was added

- **Backend:** `GET /setlist/{id}/export.csv` — dumps a setlist's per-song tone
  parameters as CSV (one row per song). Reuses `chain_to_flat()` from
  `esp32_bridge.py`, so the columns match what the firmware expects.
- **Firmware (`calgpt_pedal.ino`):** loads `setlist.csv` from LittleFS into a
  `ToneParams[]`, and switches the active tone per song. Songs advance via a
  **footswitch (GPIO)** or over **WiFi** — both work at once.

## The 13-column contract (exact order — do not reorder)

Both sides parse **by position**, so the export order and the firmware's read
order must stay identical:

```
od_drive, od_tone, od_mix,
vib_rate, vib_depth, vib_mix,
trem_rate, trem_depth, trem_mix,
dl_time_ms, dl_feedback, dl_mix,
rv_mix
```

The CSV file has a header row `song,<those 13 columns>` and then one row per
song: the song name followed by the 13 values. The firmware **skips the header**
and, on each data row, **skips the first field (song name)** and reads the 13
floats by position into a `ToneParams`.

Keep `struct ToneParams`'s field names/order aligned to these columns.

## Getting `setlist.csv` onto flash (two ways, both built in)

1. **WiFi fetch from the backend (default).** Set `EXPORT_URL` near the top of
   the sketch to your backend's export endpoint:
   ```
   #define EXPORT_URL "http://<LAPTOP_IP>:8000/setlist/<SETLIST_ID>/export.csv"
   ```
   Use the laptop's **LAN IP** (e.g. `192.168.1.42`) — **not** `localhost` /
   `127.0.0.1`, which the ESP can't reach — and the `SETLIST_ID` returned by
   `POST /setlist`. `fetchSetlistFromBackend()` does an `HTTPClient` GET and, on
   `200`, streams the body straight to `/setlist.csv` on LittleFS.
   - **Backend must listen on the LAN, not just localhost.** Start it with
     `uvicorn main:app --host 0.0.0.0 --port 8000` (default binds `127.0.0.1`,
     which the ESP can't reach). The ESP and laptop must be on the same WiFi,
     and the laptop firewall must allow the connection. `LAPTOP_IP` can change
     when you switch networks.
   - **On boot:** `setup()` calls it right after WiFi connects (before loading).
   - **On demand:** `POST /reload` to the pedal re-fetches, reloads, and jumps to
     song 0, responding `{"ok":<bool>,"songs":<count>}`. Handy for updating the
     setlist without re-flashing.
2. **Arduino "ESP32 LittleFS Data Upload" plugin (offline fallback).** Create a
   `data/` folder next to the sketch, drop `setlist.csv` in it, and run the
   upload tool — it writes the file to the LittleFS partition at `/setlist.csv`.
   Used automatically if the WiFi fetch is unset/unreachable.

`setup()` order: `LittleFS.begin(true)` → `fetchSetlistFromBackend(EXPORT_URL)`
→ `loadSetlistCSV("/setlist.csv")` → `applySong(0)`. So a flash-uploaded file
still works even with no backend reachable.

## Wiring the footswitch

- Pin: `NEXT_PIN` (default **GPIO 15** — change in the sketch to any free GPIO).
- Wire a momentary button between that pin and **GND**.
- The pin uses `INPUT_PULLUP`, so it idles HIGH and reads LOW when pressed; the
  press is debounced (~30 ms) and calls `nextSong()`.
- `prevSong()` exists too if you want to wire a second button.

## The one remaining hardware step: I2S audio I/O

Everything *except* the actual audio in/out is done:

- `processSample()` — the DSP (overdrive → vibrato → tremolo → delay → reverb).
- Param switching — staging + `paramsDirty` swap at a buffer boundary, fed by
  both the footswitch/setlist and the WiFi `POST /params` receiver.

What's left is wiring an **I2S codec** (e.g. an ESP32-A1S / LyraT audio kit, or
a PCM/ES8388-style board) and filling the two stubs in `loop()`:

```cpp
// i2s_read(...)  -> fill `buffer` with guitar input frames   // INPUT STUB
for (int i = 0; i < BUFFER_FRAMES; ++i) buffer[i] = processSample(buffer[i]);
// i2s_write(...) -> send `buffer` to the output               // OUTPUT STUB
```

Once the codec is wired and those two calls are real, it's **guitar in →
effects → out**, with the setlist/footswitch/WiFi all changing the tone live.

> If you move the DSP into its own FreeRTOS audio task (recommended once I2S is
> in), guard the `activeParams` swap with a critical section / mutex instead of
> the current plain copy (fine while everything runs in `loop()`).
