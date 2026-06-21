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
    agent_id, api_key = load_agent_config("feedback_agent")
    adapter = AnthropicAdapter(
        model="claude-sonnet-4-6",
        system_prompt=(
            "You are CalGPT's Feedback Agent. You handle rejected tones.\n\n"
            "When you receive a rejected chain + the user's complaint:\n"
            "1. Diagnose the specific parameter causing the problem "
            "(e.g. reverb mix 0.8 is too wet, drive 0.9 is too harsh).\n"
            "2. Propose exactly 3 quick fixes as short labels (2-3 words each, "
            "e.g. 'Less reverb', 'Softer drive', 'Add warmth').\n"
            "3. Tell vibe_agent what happened and what to change: "
            "'User rejected this chain. Problem: [diagnosis]. "
            "Suggested fix: [most likely fix]. Please revise.' "
            "Mention vibe_agent so they receive the request and generate a revised chain."
        ),
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("BAND_WS_URL"),
        rest_url=os.getenv("BAND_REST_URL"),
    )
    logger.info("Feedback Agent running on Band!")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
