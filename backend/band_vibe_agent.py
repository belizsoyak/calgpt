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
            "You are an expert guitar tone engineer. "
            "When a guitarist describes a tone, return a JSON effect chain with overdrive, chorus, delay, reverb params. "
            "When they give feedback like 'more reverb' or 'darker', refine the previous chain. "
            "Always respond with the JSON contract plus one sentence like a studio engineer would say. "
            "End every response with @critic_agent so the critic automatically reviews the chain."
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
