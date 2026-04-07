import logging

from pydoover.state import StateMachine

TIME_TILL_DROPOUT = 60 * 2  # 2 minutes

log = logging.getLogger(__name__)


class VegaLevelSensorState:
    state: str

    states = [
        {"name": "initial"},
        {"name": "comms"},
        {
            "name": "maybe_no_comms",
            "timeout": TIME_TILL_DROPOUT,
            "on_timeout": "lost_comms",
        },
        {"name": "no_comms"},
    ]

    transitions = [
        {"trigger": "initialise", "source": "initial", "dest": "no_comms"},
        {"trigger": "got_comms", "source": ["comms", "maybe_no_comms", "no_comms"], "dest": "comms"},
        {"trigger": "maybe_lost_comms", "source": "comms", "dest": "maybe_no_comms"},
        {"trigger": "lost_comms", "source": "maybe_no_comms", "dest": "no_comms"},
    ]

    def __init__(self):
        self.state_machine = StateMachine(
            states=self.states,
            transitions=self.transitions,
            model=self,
            initial="no_comms",
            queued=True,
        )

    async def spin(self):
        if self.state == "initial":
            await self.initialise()

    async def register_comms(self):
        await self.got_comms()

    async def register_no_comms(self):
        if self.state == "comms":
            await self.maybe_lost_comms()
