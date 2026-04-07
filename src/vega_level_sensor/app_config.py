from pathlib import Path

from pydoover import config
from pydoover.config import ApplicationPosition
from pydoover.docker.modbus import ModbusConfig


class StorageCurvePoint(config.Object):
    level = config.Number("Level", description="Level / depth in metres")
    volume = config.Number("Volume", description="Volume in megs")


class VegaLevelSensorConfig(config.Schema):
    sensor_rl = config.Number("Sensor RL", description="Sensor reference level in metres")
    full_rl = config.Number("Full RL", description="Full tank reference level in metres")
    empty_rl = config.Number("Empty RL", description="Empty tank reference level in metres")
    modbus_id = config.Integer("Modbus ID", description="Modbus ID for the sensor")

    storage_curve = config.Array(
        "Storage Curve",
        element=StorageCurvePoint("Storage Curve Point"),
    )

    modbus_config = ModbusConfig()
    position = ApplicationPosition()


def export():
    VegaLevelSensorConfig.export(
        Path(__file__).parents[2] / "doover_config.json",
        "vega_level_sensor",
    )
