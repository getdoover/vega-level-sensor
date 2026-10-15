from pathlib import Path

from pydoover import config
from pydoover.processor import ExtendedPermissionsConfig


class FarmWaterDashboardConfig(config.Schema):
    extended_permissions = ExtendedPermissionsConfig(
        extra_fields=[
            "type__name",
            "app_installs__name",
            "app_installs__display_name",
            "app_installs__application_name",
            "group__id",
            "id",
            "name",
            "display_name",
        ]
    )

    default_history_days = config.Integer(
        "Default History Days",
        default=7,
        minimum=1,
        maximum=30,
        description="Default period shown in the farm and dam/device capacity graphs.",
    )

    title = config.String(
        "Title",
        default="Stored Water",
        description="Heading for the dashboard, e.g. Stored Water or Stored Diesel.",
    )

    unit = config.String(
        "Unit",
        default="ML",
        description="Volume unit label. Must match the devices' volume tags: ML for Vega, L for Agbot and Analog Level Sensor.",
    )

    position = config.ApplicationPosition()


def export():
    FarmWaterDashboardConfig.export(
        Path(__file__).parents[2] / "doover_config.json",
        "farm_water_dashboard",
    )
