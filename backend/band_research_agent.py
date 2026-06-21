import asyncio
import logging
import os
from dotenv import load_dotenv
from band import Agent
from band.adapters import AnthropicAdapter
from band.config import load_agent_config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main():
    load_dotenv()
    agent_id, api_key = load_agent_config("research_agent")
    adapter = AnthropicAdapter(
        model="claude-sonnet-4-6",
        system_prompt=(
            "You are CalGPT's Research Agent. Every tone request starts with you.\n\n"
            "When you receive a message:\n"
            "1. If it names a guitarist (Hendrix, SRV, Gilmour, The Edge, Cobain, John Mayer, "
            "Santana, Clapton, Brian May, Angus Young) — describe their known gear and signature "
            "sound in 2-3 sentences (amp model, key pedals, characteristic settings).\n"
            "2. If it's a tone descriptor (warm, crunchy, bluesy, heavy, etc.) — translate it into "
            "gear language (e.g. 'warm bluesy = mid-gain overdrive, light reverb, slapback delay').\n\n"
            "ALWAYS finish by handing off to vibe_agent. Say exactly what you found and ask "
            "vibe_agent to build the full effect chain from it. "
            "Mention vibe_agent so they receive the message."
        ),
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("BAND_WS_URL"),
        rest_url=os.getenv("BAND_REST_URL"),
    )
    logger.info("Research Agent running on Band!")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
