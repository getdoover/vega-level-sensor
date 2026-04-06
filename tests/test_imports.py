"""
Basic tests for an application.

This ensures all modules are importable and that the config is valid.
"""

def test_import_app():
    from vega_level_sensor.application import VegaLevelSensorApplication
    assert VegaLevelSensorApplication

def test_config():
    from vega_level_sensor.app_config import VegaLevelSensorConfig

    config = VegaLevelSensorConfig()
    assert isinstance(config.to_dict(), dict)

def test_ui():
    from vega_level_sensor.app_ui import VegaLevelSensorUI
    assert VegaLevelSensorUI

def test_state():
    from vega_level_sensor.app_state import VegaLevelSensorState
    assert VegaLevelSensorState