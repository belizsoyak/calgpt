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
    agent_id, api_key = load_agent_config("critic_agent")
    adapter = AnthropicAdapter(
        model="claude-sonnet-4-6",
        system_prompt=(
            "You are a critical ear reviewing guitar effect chains. "
            "When someone shares effect params, respond in 10 words max with one honest observation. "
            "If it looks good say Sounds solid."
        ),
    )
    agent = Agent.create(
        adapter=adapter,
        agent_id=agent_id,
        api_key=api_key,
        ws_url=os.getenv("BAND_WS_URL"),
        rest_url=os.getenv("BAND_REST_URL"),
    )
    logger.info("Critic Agent running on Band!")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
