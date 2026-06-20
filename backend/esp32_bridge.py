"""Bridge between the CalGPT effect chain and the ESP32 pedal firmware.

The agent returns a structured chain (overdrive / chorus / delay / reverb).
The firmware (firmware/calgpt_pedal.ino) expects a single flat block of
parameters. This module flattens one into the other and pushes it over WiFi.
"""

import requests

# Bypass-safe defaults: every effect contributes nothing until overridden.
# Mirrors the FxParams struct / defaults in firmware/calgpt_pedal.ino.
FLAT_DEFAULTS = {
    "od_drive": 0.0, "od_tone": 0.5, "od_mix": 0.0,
    "vib_rate": 0.0, "vib_depth": 0.0, "vib_mix": 0.0,
    "trem_rate": 0.0, "trem_depth": 0.0, "trem_mix": 0.0,
    "dl_time_ms": 0.0, "dl_feedback": 0.0, "dl_mix": 0.0,
    "rv_mix": 0.0,
}


def chain_to_flat(chain: dict) -> dict:
    """Flatten an agent effect chain into the firmware's flat params.

    Maps chorus -> vibrato. Effects missing from the chain keep their
    bypass defaults. Reverb contributes only rv_mix (the firmware uses a
    fixed-decay reverb).
    """
    flat = dict(FLAT_DEFAULTS)

    for fx in chain.get("effects", []):
        t = fx.get("type")
        if t == "overdrive":
            flat["od_drive"] = float(fx.get("drive", 0.0))
            flat["od_tone"] = float(fx.get("tone", 0.5))
            flat["od_mix"] = float(fx.get("mix", 0.0))
        elif t == "chorus":  # chorus -> vibrato
            flat["vib_rate"] = float(fx.get("rate_hz", 0.0))
            flat["vib_depth"] = float(fx.get("depth", 0.0))
            flat["vib_mix"] = float(fx.get("mix", 0.0))
        elif t == "delay":
            flat["dl_time_ms"] = float(fx.get("time_ms", 0.0))
            flat["dl_feedback"] = float(fx.get("feedback", 0.0))
            flat["dl_mix"] = float(fx.get("mix", 0.0))
        elif t == "reverb":
            flat["rv_mix"] = float(fx.get("mix", 0.0))

    return flat


def push_to_pedal(chain: dict, esp_ip: str) -> bool:
    """POST the flattened params to the pedal. Never raises.

    Returns True if the pedal accepted the params, False if it was
    unreachable, timed out, or returned an error.
    """
    flat = chain_to_flat(chain)
    url = f"http://{esp_ip}/params"
    try:
        resp = requests.post(url, json=flat, timeout=2)
        return resp.ok
    except requests.RequestException:
        return False
