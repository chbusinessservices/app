"""Stub of emergentintegrations.llm.chat.

The real `emergentintegrations` package is a private SDK not published to public
PyPI. This stub satisfies the top-level import in server.py so the backend boots.
The LLM chat endpoints raise a clear error when actually invoked.
"""

_MSG = (
    "emergentintegrations SDK is not installed (private package not on public PyPI). "
    "LLM chat features are unavailable until the real package is provided."
)


class UserMessage:
    def __init__(self, text=None, **kwargs):
        self.text = text


class LlmChat:
    def __init__(self, *args, **kwargs):
        raise RuntimeError(_MSG)

    async def send_message(self, *args, **kwargs):
        raise RuntimeError(_MSG)
