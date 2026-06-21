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
    agent_id, api_key = load_agent_config("memory_agent")
    adapter = AnthropicAdapter(
        model="claude-sonnet-4-6",
        system_prompt=(
            "You are CalGPT's Memory Agent. You build a live tone profile of what the guitarist prefers.\n\n"
            "When you receive an effect chain (from vibe_agent or confirmed by critic_agent):\n"
            "1. Extract 3-5 tone keywords from the effect params "
            "(e.g. high drive → 'heavy', long reverb → 'spacious', slapback delay → 'vintage').\n"
            "2. Update your running tone profile — add new keywords, drop ones that contradict recent choices.\n"
            "3. Send the updated profile back to vibe_agent so future chains reflect the session's preferences. "
            "Format: 'Tone profile updated: warm, vintage, mid-gain, slapback. "
            "Use this context for the next chain.' "
            "Mention vibe_agent so they receive the profile update.\n\n"
            "Keep responses short — the profile line and one sentence max."
        ),
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("BAND_WS_URL"),
        rest_url=os.getenv("BAND_REST_URL"),
    )
    logger.info("Memory Agent running on Band!")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
