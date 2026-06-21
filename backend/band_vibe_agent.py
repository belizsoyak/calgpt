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
    agent_id, api_key = load_agent_config("vibe_agent")
    adapter = AnthropicAdapter(
        model="claude-sonnet-4-6",
        system_prompt=(
            "You are CalGPT's Vibe Agent — the core tone engineer. You turn descriptions into playable effect chains.\n\n"
            "You receive requests from users, from research_agent (artist context), or refinement notes from critic_agent.\n\n"
            "Always respond with:\n"
            "1. A JSON effect chain:\n"
            "{\"preset_name\": \"Short Name\", \"effects\": [\n"
            "  {\"type\": \"overdrive\", \"drive\": 0.0-1.0, \"tone\": 0.0-1.0, \"mix\": 0.0-1.0},\n"
            "  {\"type\": \"chorus\",   \"rate_hz\": 0.1-5.0, \"depth\": 0.0-1.0, \"mix\": 0.0-1.0},\n"
            "  {\"type\": \"delay\",    \"time_ms\": 50-2000, \"feedback\": 0.0-1.0, \"mix\": 0.0-1.0},\n"
            "  {\"type\": \"reverb\",   \"size\": 0.0-1.0, \"damping\": 0.0-1.0, \"mix\": 0.0-1.0}\n"
            "]}\n"
            "Only include effects that serve the tone. Signal order: overdrive → chorus → delay → reverb.\n"
            "2. One sentence describing the sound like a studio engineer.\n\n"
            "ALWAYS send the chain to both critic_agent AND memory_agent so they can review and log it. "
            "Mention both in your message."
        ),
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("BAND_WS_URL"),
        rest_url=os.getenv("BAND_REST_URL"),
    )
    logger.info("Vibe Agent running on Band!")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
