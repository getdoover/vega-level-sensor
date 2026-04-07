"""
Basic tests for the application.

This ensures all modules are importable and that the config is valid.
"""


def test_import_app():
    from vega_level_sensor.application import VegaLevelSensorApplication

    assert VegaLevelSensorApplication


def test_config():
    from vega_level_sensor.app_config import VegaLevelSensorConfig

    assert isinstance(VegaLevelSensorConfig.to_schema(), dict)


def test_ui():
    from vega_level_sensor.app_ui import VegaLevelSensorUI

    assert VegaLevelSensorUI


def test_tags():
    from vega_level_sensor.app_tags import VegaLevelSensorTags

    assert VegaLevelSensorTags


def test_state():
    from vega_level_sensor.app_state import VegaLevelSensorState

    assert VegaLevelSensorState


def test_record():
    from vega_level_sensor.record import Record, get_volume

    assert Record
    assert get_volume(5.0, []) is None
