from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any
import uuid


@dataclass
class ToolCall:
    tool_name: str
    params: dict[str, Any]
    agent_id: str
    call_id: str = field(default_factory=lambda: str(uuid.uuid4()))


@dataclass
class GuardrailResult:
    call_id: str
    verdict: str        # "allowed" | "blocked"
    explanation: str
    lean_trace: str
    latency_us: int


class BaseAgent(ABC):
    @abstractmethod
    def get_pending_action(self) -> ToolCall | None: ...

    @abstractmethod
    def receive_result(self, result: GuardrailResult) -> None: ...
