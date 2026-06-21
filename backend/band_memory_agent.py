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
            "You are CalGPT's Memory Agent. You track what a guitarist prefers across the session. "
            "When agents share effect chains, extract 3-5 tone preference keywords (warm, dark, heavy drive, etc.). "
            "Keep a running summary and share it back when @mentioned. "
            "Format: 'Tone profile: warm, dark, slapback delay, light reverb' "
            "Use the band_send_message tool to respond."
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
