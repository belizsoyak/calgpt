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
            "You are CalGPT's Research Agent. You know the gear and tone settings of famous guitarists. "
            "When someone mentions an artist name (Hendrix, SRV, Gilmour, The Edge, Cobain, John Mayer, Santana, Clapton, Brian May), "
            "respond with their signature tone as a JSON effect chain: "
            "{\"preset_name\": \"...\", \"effects\": [...]}. "
            "Then @mention @vibe_agent with the chain so they can refine it further. "
            "If no known artist is mentioned, say you only handle artist lookups. "
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
    logger.info("Research Agent running on Band!")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
