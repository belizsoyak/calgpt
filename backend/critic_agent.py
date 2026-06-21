from typing import Optional
from session import SessionManager


def _analyze(contract: dict) -> Optional[str]:
    effects = contract.get("effects", [])
    by_type = {e["type"]: e for e in effects}

    delay = by_type.get("delay")
    reverb = by_type.get("reverb")
    overdrive = by_type.get("overdrive")

    if delay and reverb:
        if delay.get("mix", 0) > 0.5 and reverb.get("mix", 0) > 0.5:
            return "Heavy delay and reverb together will get muddy — consider pulling one back."

    if delay and delay.get("feedback", 0) > 0.85:
        return "Delay feedback above 0.85 risks runaway — watch your volume."

    if overdrive and reverb:
        if overdrive.get("drive", 0) > 0.8 and reverb.get("mix", 0) > 0.5:
            return "High drive into heavy reverb washes out the attack — try less reverb mix."

    return None


async def run_critic_agent(session_id: str, contract: dict, sessions: SessionManager):
    issue = _analyze(contract)
    if issue:
        await sessions.send(session_id, {
            "type": "critic_message",
            "agent": "critic",
            "message": issue,
            "contract": None,
        })
