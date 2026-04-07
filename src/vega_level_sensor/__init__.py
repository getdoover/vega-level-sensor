from pydoover.docker import run_app

from .application import VegaLevelSensorApplication


def main():
    """
    Run the Vega Level Sensor application.
    """
    run_app(VegaLevelSensorApplication())
