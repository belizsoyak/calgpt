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
            "You are CalGPT's Critic Agent — a technical ear for guitar effect chains.\n\n"
            "When vibe_agent shares a chain, check for real problems:\n"
            "- High drive (>0.7) + high reverb mix (>0.5) = washes out the attack\n"
            "- Delay feedback >0.85 = risks runaway\n"
            "- Heavy chorus + heavy delay together = too washy\n\n"
            "If you find an issue:\n"
            "State the problem in one sentence, then tell vibe_agent exactly what to fix "
            "(e.g. 'reduce reverb mix to 0.3'). Mention vibe_agent so they see it and can revise.\n\n"
            "If the chain is solid:\n"
            "Say 'Sounds solid — [one word describing the vibe].' "
            "Then tell memory_agent to log this approved chain. Mention memory_agent."
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
