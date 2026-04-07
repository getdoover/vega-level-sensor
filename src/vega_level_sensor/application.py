import logging
import time

from pydoover import ui
from pydoover.docker import Application

from .app_config import VegaLevelSensorConfig
from .app_tags import VegaLevelSensorTags
from .app_ui import VegaLevelSensorUI
from .app_state import VegaLevelSensorState
from .record import Record


log = logging.getLogger()

START_REG_NUM = 100
NUM_REGS = 18
REGISTER_TYPE = 3


class VegaLevelSensorApplication(Application):
    config: VegaLevelSensorConfig
    tags: VegaLevelSensorTags

    config_cls = VegaLevelSensorConfig
    tags_cls = VegaLevelSensorTags
    ui_cls = VegaLevelSensorUI

    async def setup(self):
        self.state = VegaLevelSensorState()
        self.last_record: Record | None = None
        self.last_request_time: float = 0
        self.min_request_interval = 5

    async def main_loop(self):
        await self._send_request()
        await self.state.spin()

        if self.state.state == "no_comms":
            log.warning("No comms, clearing last record")
            self.last_record = None
            await self._clear_display_tags()
        else:
            await self._update_display_tags()

    async def _update_display_tags(self):
        if self.last_record is None:
            return

        show_volume = len(self.config.storage_curve.elements) > 0
        if show_volume:
            await self.tags.last_volume.set(self.last_record.output_volume)
        else:
            await self.tags.last_volume.set(self.last_record.level_percentage)

        await self.tags.last_rl.set(self.last_record.rl_reading)
        await self.tags.time_last_update.set(int(time.time() - self.last_record.ts))
        await self.tags.last_raw_distance.set(self.last_record.sensor_distance)
        await self.tags.last_reliability.set(self.last_record.measurement_reliability)

        # Update event volume if active
        if self.tags.event_active.value:
            initial = self.tags.event_initial_volume.value
            current = self.last_record.output_volume
            if initial is not None and current is not None:
                await self.tags.event_volume.set(current - initial)
            elif current is not None:
                await self.tags.event_volume.set(current)

    async def _clear_display_tags(self):
        await self.tags.last_volume.set(None)
        await self.tags.last_rl.set(None)
        await self.tags.time_last_update.set(None)
        await self.tags.last_raw_distance.set(None)
        await self.tags.last_reliability.set(None)

    async def _send_request(self):
        if time.time() - self.last_request_time < self.min_request_interval:
            return

        result = await self.modbus_iface.read_registers_async(
            bus_id=self.config.modbus_config.name.value,
            modbus_id=int(self.config.modbus_id.value),
            start_address=START_REG_NUM,
            num_registers=NUM_REGS,
            register_type=REGISTER_TYPE,
        )
        if not result:
            log.info("Failed to send modbus request")
            await self.state.register_no_comms()
            return

        self.last_record = Record(result, self.config)
        await self.state.register_comms()
        self.last_request_time = time.time()

    # --- UI Handlers ---

    @ui.handler("start_event")
    async def on_start_event(self, ctx, value):
        log.info("Starting event")
        if not self.tags.event_active.value:
            initial = self.last_record.output_volume if self.last_record else None
            await self.tags.event_active.set(True)
            await self.tags.event_initial_volume.set(initial)
            await self.tags.event_started_at.set(time.time())
            await self.tags.start_event_hidden.set(True)
            await self.tags.stop_event_hidden.set(False)

    @ui.handler("stop_event")
    async def on_stop_event(self, ctx, value):
        log.info("Stopping event")
        if self.tags.event_active.value:
            await self.tags.event_active.set(False)

        await self.tags.start_event_hidden.set(False)
        await self.tags.stop_event_hidden.set(True)
        await self.tags.event_volume.set(None)
        await self.tags.event_initial_volume.set(None)
        await self.tags.event_started_at.set(None)
