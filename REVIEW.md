# CalGPT — Setup & Review Notes

Summary of a local run-through + firmware review. Covers what was verified, what
had to be fixed to boot, and the bugs worth addressing.

> **TL;DR** — The app runs locally and `/vibe` works end-to-end against Claude,
> but **one startup bug had to be patched** (`backend/band_bus.py` imports an
> uninstalled `band` SDK at module top, crashing the whole backend — still
> present upstream). The repo is otherwise current with `main`. The **firmware
> has two issues worth fixing before hardware**: a **32-bit audio overflow** in
> the reverb/delay feedback (reproduced — a sustained loud note wraps on 1600/2000
> samples → audible crackle), and **three out-of-sync copies** of the firmware
> that will cause fixes to land in only one. Architecture is otherwise solid and
> the DSP test harness builds and runs cleanly.

---

## ✅ Run-through (verified working)

- **Backend + frontend both run locally** on Python 3.13 / Node 22. All deps
  install cleanly, including `pedalboard` + `numpy`.
- **Live `/vibe` works end-to-end** — a real Claude call (`claude-sonnet-4-6`)
  returned a valid effect chain. `/health` and the `/preview` audio render
  (returns a real WAV) also pass with no API key.
- Ran on ports **8001 (backend)** / **5174 (frontend)** only to avoid another
  copy already holding 8000/5173.

## 📦 Repo currency

- Diffed against the latest `belizsoyak/calgpt` `main` (top commit `fec0c97`):
  this copy was **already up to date** — no new frontend or backend changes
  upstream.

---

## 🔧 Fixes needed to boot

### 1. `backend/band_bus.py` — startup crash (still present upstream)
`band_bus.py` did `from band.config import load_agent_config` at module top, but
the `band` SDK is **not in `requirements.txt` and not installed**, so importing
`main.py` failed and the **entire backend wouldn't start** — even though the
band.ai feature is optional and gated behind the `BAND_ROOM_ID` env var.

Fix applied — make the import optional so the module loads without the SDK:

```python
try:
    from band.config import load_agent_config
except ImportError:  # band SDK is optional — features gated behind BAND_ROOM_ID
    load_agent_config = None
```

### 2. `frontend/src/App.jsx` — hardcoded backend URL
`API` / `WS_URL` are hardcoded to `localhost:8000` with no env override. Pointed
them at `8001` for local testing; revert to `8000` for the standard setup, or
make them read an env var (`import.meta.env.VITE_API_URL`) so it's configurable.

---

## 🎸 Firmware review (`firmware/`)

### 🔴 High — reverb/delay feedback overflows 32-bit audio
The DSP runs at full int32 scale (±2³¹) with **no headroom** in the feedback
sums:

```c
float wet = x + tail;              // reverb
reverb_buf[w] = (int32_t)wet;      // truncates -> hard wraparound
```

A feedback comb at gain 0.6 settles to `x/(1-0.6) = 2.5·x` for sustained input.
Reproduced with a sustained 0.8-full-scale note (the SRV overdrive+reverb
`hwtest` preset):

```
input mag       = 1.72e9   (2^31 = 2.15e9)
peak wet (true) = 3.01e9   -> exceeds int32 by 1.40x
samples that overflowed int32 store = 1600 / 2000
```

The wrapped value is written back into the feedback buffer and re-fed, so it's a
hard wraparound, not a soft clip → audible digital crackle on sustained/loud
notes. Same applies to the delay path (`wet = x + echo*feedback`). The desktop
harness partly masks it because the *final* output stage runs `tanhf()`, but the
feedback buffer is already corrupted.

**Fix:** work at a lower internal scale (e.g. ±2²⁸) for feedback headroom, or
clamp / `tanhf` before the `(int32_t)` store-back.

### 🔴 High — three divergent copies of the "same" firmware
Two different `calgpt_pedal.ino` and two different `*_hwtest.ino` exist and have
drifted structurally (not just whitespace):

| | `firmware/calgpt_pedal.ino` (root) | `firmware/calgpt_pedal/calgpt_pedal.ino` |
|---|---|---|
| Struct | `ToneParams` | `FxParams` |
| DSP API | `processSample(int32_t)` | `process_buffer(buf, n)` |
| Features | **+ setlist (LittleFS CSV), footswitch GPIO 15, `/reload`, HTTPClient** | WiFi `/params` only |
| Param swap | plain (correct: single-threaded, no ISR) | `noInterrupts()` (guards an ISR that doesn't exist) |

The root copy is actually the **newer / more capable** one. Also
`calgpt_pedal/calgpt_pedal_hwtest.ino` regressed `DELAY_MAX_MS` 100 → 2000,
inflating the three delay lines from ~9.6 KB to **~192 KB of SRAM** for no
benefit (delay + vibrato are off in hwtest).

**Fix:** pick one canonical sketch per target and delete the duplicates. Arduino
requires the `.ino` to sit in a same-named folder, which is what drives the
copies — a shared `dsp.h` (or symlink) avoids the drift.

### 🟡 Medium — DSP correctness / quality
- **Overdrive "tone" comment is wrong.** Code is a pure one-pole **low-pass**
  with variable cutoff; the comment claims it can go "bright (high-pass-ish)."
  It only ever darkens. `od_lp_state` also persists across an `od_mix`
  on→off→on toggle, leaking stale state.
- **Vibrato has no fractional interpolation** (`int rd = vib_write - (int)lfo`)
  → zipper/quantization noise, worse at 5–8 kHz. It's also a unipolar 0…depth
  sweep, so it's really a chorus/flanger, not true (bipolar) vibrato.
- **Reverb isn't a true wet/dry.** `wet = x + tail` then
  `x = x*(1-mix) + wet*mix` re-adds dry inside `wet`, so even at `mix=1` you get
  `x + tail` rather than pure tail — the mix knob doesn't do what it says.

### 🟡 Medium — real-time structure
- **The WiFi firmware never processes real audio.** Both `calgpt_pedal.ino`
  loops call the DSP on a `static` buffer with I²S read/write commented out — it
  processes silence. Only the `hwtest` sketch does real ADC→DSP→DAC I/O.
- **`hwtest` runs `process_buffer` inline in the sample loop.** At the 256th
  sample it runs 256 iterations of `tanhf`/`sinf` synchronously, starving
  ADC/DAC for that span → periodic glitch if it exceeds 125 µs. For clean audio:
  double-buffer + run the DSP on a second core (`xTaskCreatePinnedToCore`).

### 🟢 Low / nits
- `micros()` wraps every ~71 min; `if (now < next_us) return;` mis-fires once at
  wraparound.
- `noInterrupts()` in the `calgpt_pedal/` swap is unnecessary (WebServer is
  polled synchronously in `loop()`).
- `rd % DELAY_LINE_LEN` in vibrato is redundant after the `while (rd<0)`.
- Harness runs at 5 kHz vs firmware's 8 kHz; the only SR-dependent integers are
  ms-derived so behavior matches — worth a one-line comment.

---

## Net

Architecture is sound and testable: one param struct, double-buffered swaps, and
a DSP core shared between firmware and a desktop harness (which **builds and runs
cleanly**). Before trusting it on hardware, fix the **int32 feedback overflow**
(real, reproduced) and **consolidate the duplicate sketches** (otherwise a fix
to one copy won't ship in the other). 
