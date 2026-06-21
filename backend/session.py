from collections import defaultdict
from fastapi import WebSocket


class SessionManager:
    def __init__(self):
        self.connections: dict[str, WebSocket] = {}
        self.histories: dict[str, list] = defaultdict(list)
        self.memories: dict[str, str] = {}
        self.approved_chains: dict[str, list] = defaultdict(list)
        self.rejections: dict[str, list] = defaultdict(list)

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        self.connections[session_id] = ws

    def disconnect(self, session_id: str):
        self.connections.pop(session_id, None)

    async def send(self, session_id: str, data: dict):
        ws = self.connections.get(session_id)
        if ws:
            await ws.send_json(data)

    def add_to_history(self, session_id: str, role: str, content: str):
        self.histories[session_id].append({"role": role, "content": content})

    def get_history(self, session_id: str) -> list:
        return self.histories[session_id]

    def set_memory(self, session_id: str, memory: str):
        self.memories[session_id] = memory

    def get_memory(self, session_id: str) -> str:
        return self.memories.get(session_id, "")

    def add_approved_chain(self, session_id: str, contract: dict):
        self.approved_chains[session_id].append(contract)

    def get_approved_chains(self, session_id: str) -> list:
        return self.approved_chains[session_id]

    def add_rejection(self, session_id: str, reason: str, contract: dict):
        self.rejections[session_id].append({"reason": reason, "contract": contract})

    def get_rejections(self, session_id: str) -> list:
        return self.rejections[session_id]
