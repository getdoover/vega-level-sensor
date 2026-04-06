from pydoover.docker import run_app

from .application import VegaLevelSensorApplication
from .app_config import VegaLevelSensorConfig

def main():
    """
    Run the application.
    """
    run_app(VegaLevelSensorApplication(config=VegaLevelSensorConfig()))
