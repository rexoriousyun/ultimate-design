"""A running chat turn, decoupled from the HTTP response that started it.

The server runs each turn as a background task that publishes events here. Any number
of followers (the tab that sent the message, or a tab that reconnects after a reload)
stream them from a given index. Closing a tab ends only its follower, never the turn.
"""

import asyncio


class Turn:
    def __init__(self):
        self.events: list[dict] = []
        self.finished = False
        self.stopped = False  # set by the stop route so no further nudge run starts
        self.task: asyncio.Task | None = None  # held so the task is not garbage-collected
        self._changed = asyncio.Condition()

    async def publish(self, event: dict) -> None:
        # Append before any await, so the event is counted in the same step the server
        # logs it to chat.jsonl.
        self.events.append(event)
        async with self._changed:
            self._changed.notify_all()

    async def finish(self) -> None:
        async with self._changed:
            self.finished = True
            self._changed.notify_all()

    async def follow(self, start: int = 0):
        """Yield events from index `start` as they arrive, until the turn finishes."""
        i = start
        while True:
            async with self._changed:
                await self._changed.wait_for(lambda: len(self.events) > i or self.finished)
                new, done = self.events[i:], self.finished
            i += len(new)
            for event in new:
                yield event
            if done:
                return
