from pydoover.processor import run_app

from .app_config import FarmWaterDashboardConfig
from .application import FarmWaterDashboardApp


def handler(event, context):
    """Lambda handler entry point."""
    FarmWaterDashboardConfig.clear_elements()
    return run_app(
        FarmWaterDashboardApp(),
        event,
        context,
    )
