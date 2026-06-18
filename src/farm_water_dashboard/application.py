import logging
from datetime import datetime, timezone

from pydoover.models import (
    ConnectionConfig,
    ConnectionDetermination,
    ConnectionStatus,
    ConnectionType,
    DeploymentEvent,
)
from pydoover.models.data.connection import ConnectionDisplay
from pydoover.processor import Application

from .app_config import FarmWaterDashboardConfig
from .app_ui import FarmWaterDashboardUI


log = logging.getLogger(__name__)


class FarmWaterDashboardApp(Application):
    """Farm-level water capacity dashboard.

    The processor hosts the remote component and grants the widget access to
    configured devices. Capacity calculations and drill-down behaviour run in
    the browser, mirroring the Power Management dashboard pattern.
    """

    config_cls = FarmWaterDashboardConfig
    ui_cls = FarmWaterDashboardUI

    async def on_deployment(self, event: DeploymentEvent):
        await self.api.ping_connection_at(
            datetime.now(timezone.utc),
            ConnectionStatus.continuous_online_no_ping,
            ConnectionDetermination.online,
            user_agent="vega-level-sensor;farm-water-dashboard",
        )
        await self.api.update_connection_config(
            ConnectionConfig(ConnectionType.periodic, display=ConnectionDisplay.never)
        )
        log.info("Pinged connection for farm water dashboard agent %s", self.agent_id)
