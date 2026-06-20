import shutil

try:
    from pedalboard import Pedalboard, Overdrive, Chorus, Delay, Reverb
    from pedalboard.io import AudioFile
    _HAS_PEDALBOARD = True
except ImportError:
    _HAS_PEDALBOARD = False


def apply_chain(input_path: str, contract: dict, output_path: str) -> None:
    """Apply an effect chain contract to an audio file via pedalboard."""
    if not _HAS_PEDALBOARD:
        # stub: pass audio through unchanged until pedalboard is installed
        shutil.copy(input_path, output_path)
        return

    board = Pedalboard()

    for fx in contract.get("effects", []):
        t = fx["type"]
        if t == "overdrive":
            # pedalboard Overdrive only exposes drive_db; tone/mix are not native params
            board.append(Overdrive(drive_db=fx["drive"] * 40))
        elif t == "chorus":
            board.append(Chorus(rate_hz=fx["rate_hz"], depth=fx["depth"], mix=fx["mix"]))
        elif t == "delay":
            board.append(Delay(delay_seconds=fx["time_ms"] / 1000, feedback=fx["feedback"], mix=fx["mix"]))
        elif t == "reverb":
            board.append(
                Reverb(
                    room_size=fx["size"],
                    damping=fx["damping"],
                    wet_level=fx["mix"],
                    dry_level=1.0 - fx["mix"],
                )
            )

    with AudioFile(input_path) as f:
        audio = f.read(f.frames)
        sr = f.samplerate
        channels = f.num_channels

    processed = board(audio, sr)

    with AudioFile(output_path, "w", sr, channels) as f:
        f.write(processed)
