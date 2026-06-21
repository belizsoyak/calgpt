_PRESETS = [
    (
        ("hendrix", "jimi"),
        {
            "preset_name": "Hendrix — Electric Ladyland",
            "effects": [
                {"type": "overdrive", "drive": 0.82, "tone": 0.6, "mix": 0.95},
                {"type": "reverb", "size": 0.3, "damping": 0.4, "mix": 0.2},
            ],
        },
    ),
    (
        ("srv", "stevie ray vaughan", "stevie ray"),
        {
            "preset_name": "SRV — Texas Blues",
            "effects": [
                {"type": "overdrive", "drive": 0.75, "tone": 0.5, "mix": 0.9},
                {"type": "reverb", "size": 0.2, "damping": 0.5, "mix": 0.15},
            ],
        },
    ),
    (
        ("gilmour", "pink floyd"),
        {
            "preset_name": "Gilmour — Comfortably Numb",
            "effects": [
                {"type": "overdrive", "drive": 0.35, "tone": 0.45, "mix": 0.7},
                {"type": "delay", "time_ms": 450, "feedback": 0.55, "mix": 0.4},
                {"type": "reverb", "size": 0.65, "damping": 0.35, "mix": 0.4},
            ],
        },
    ),
    (
        ("the edge", "edge", "u2"),
        {
            "preset_name": "The Edge — U2 Rhythms",
            "effects": [
                {"type": "chorus", "rate_hz": 0.5, "depth": 0.3, "mix": 0.4},
                {"type": "delay", "time_ms": 380, "feedback": 0.6, "mix": 0.5},
                {"type": "reverb", "size": 0.5, "damping": 0.4, "mix": 0.35},
            ],
        },
    ),
    (
        ("cobain", "nirvana", "kurt"),
        {
            "preset_name": "Cobain — Nevermind",
            "effects": [
                {"type": "overdrive", "drive": 0.88, "tone": 0.4, "mix": 1.0},
                {"type": "chorus", "rate_hz": 1.2, "depth": 0.5, "mix": 0.3},
                {"type": "reverb", "size": 0.3, "damping": 0.5, "mix": 0.2},
            ],
        },
    ),
    (
        ("john mayer", "mayer"),
        {
            "preset_name": "John Mayer — Slow Dancing",
            "effects": [
                {"type": "overdrive", "drive": 0.25, "tone": 0.55, "mix": 0.65},
                {"type": "delay", "time_ms": 310, "feedback": 0.3, "mix": 0.25},
                {"type": "reverb", "size": 0.4, "damping": 0.5, "mix": 0.3},
            ],
        },
    ),
    (
        ("santana", "carlos santana"),
        {
            "preset_name": "Santana — Smooth",
            "effects": [
                {"type": "overdrive", "drive": 0.55, "tone": 0.5, "mix": 0.85},
                {"type": "chorus", "rate_hz": 0.8, "depth": 0.4, "mix": 0.3},
                {"type": "reverb", "size": 0.5, "damping": 0.4, "mix": 0.35},
            ],
        },
    ),
    (
        ("clapton", "eric clapton"),
        {
            "preset_name": "Clapton — Crossroads",
            "effects": [
                {"type": "overdrive", "drive": 0.45, "tone": 0.55, "mix": 0.85},
                {"type": "reverb", "size": 0.25, "damping": 0.5, "mix": 0.2},
            ],
        },
    ),
    (
        ("brian may", "queen"),
        {
            "preset_name": "Brian May — Bohemian",
            "effects": [
                {"type": "overdrive", "drive": 0.4, "tone": 0.6, "mix": 0.8},
                {"type": "chorus", "rate_hz": 0.6, "depth": 0.5, "mix": 0.45},
                {"type": "reverb", "size": 0.55, "damping": 0.4, "mix": 0.35},
            ],
        },
    ),
]


def lookup_artist(message: str) -> dict | None:
    msg = message.lower()
    # Longer terms checked first to avoid "edge" matching "knowledge" etc.
    for terms, preset in _PRESETS:
        for term in sorted(terms, key=len, reverse=True):
            if term in msg:
                return preset
    return None
