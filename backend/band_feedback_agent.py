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
            "You are CalGPT's Feedback Agent. When a guitarist rejects a tone, diagnose the issue. "
            "Analyze the effect chain params and identify exactly 3 quick fixes (2-3 words each). "
            "Then @mention @vibe_agent with: 'User rejected last chain. Issue: [fix they picked]. "
            "Previous chain: [contract JSON]. Please adjust accordingly.' "
            "Always close the loop back to the Vibe Agent. "
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
    logger.info("Feedback Agent running on Band!")
    await agent.run()


if __name__ == "__main__":
    asyncio.run(main())
