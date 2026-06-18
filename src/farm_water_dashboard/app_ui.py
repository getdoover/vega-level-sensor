from pathlib import Path

from pydoover import ui


class FarmWaterDashboardUI(ui.UI, default_open=True):
    widget = ui.RemoteComponent(
        name="FarmWaterDashboard",
        display_name="Farm Water Dashboard",
        component_url="$config.app().dv_widget_url",
        scope="WaterCapacityDashboardWidget",
        module="./WaterCapacityDashboardWidget",
        app_key="$config.app().APP_KEY",
    )


def export():
    FarmWaterDashboardUI(None, None, None).export(
        Path(__file__).parents[2] / "doover_config.json", "farm_water_dashboard"
    )
