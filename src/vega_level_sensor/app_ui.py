from pydoover import ui

from .app_config import VegaLevelSensorConfig
from .app_tags import VegaLevelSensorTags
from .record import get_volume


class VegaLevelSensorUI(ui.UI):
    config: VegaLevelSensorConfig

    last_volume = ui.NumericVariable(
        "Volume",
        units="megs",
        value=VegaLevelSensorTags.last_volume,
        precision=0,
        form=ui.Widget.radial,
        ranges=[
            ui.Range("Low", 0, 40, colour=ui.Colour.yellow),
            ui.Range("Half", 40, 80, colour=ui.Colour.blue),
            ui.Range("Full", 80, 100, colour=ui.Colour.green),
        ],
    )

    last_level = ui.NumericVariable(
        "Level",
        units="%",
        value=VegaLevelSensorTags.last_volume,
        precision=0,
        form=ui.Widget.radial,
    )

    last_rl = ui.NumericVariable(
        "Water RL",
        units="m",
        value=VegaLevelSensorTags.last_rl,
        precision=3,
    )

    start_event = ui.Button(
        "Start Event",
        hidden=VegaLevelSensorTags.start_event_hidden,
    )

    stop_event = ui.Button(
        "Stop Event",
        hidden=VegaLevelSensorTags.stop_event_hidden,
    )

    event_volume = ui.NumericVariable(
        "Event Volume",
        units="ML",
        value=VegaLevelSensorTags.event_volume,
        precision=2,
        hidden=VegaLevelSensorTags.stop_event_hidden,
    )

    time_last_update = ui.Timestamp(
        "Time Since Last Read",
        value=VegaLevelSensorTags.time_last_update,
    )

    sensor_details = ui.Submodule(
        "Sensor Details",
        children=[
            ui.NumericVariable(
                "Sensor Distance",
                units="m",
                value=VegaLevelSensorTags.last_raw_distance,
                precision=3,
            ),
            ui.NumericVariable(
                "Measurement Reliability",
                units="dB",
                value=VegaLevelSensorTags.last_reliability,
                precision=1,
                ranges=[
                    ui.Range("Bad", 0, 20, colour=ui.Colour.yellow),
                    ui.Range("Good", 20, 100, colour=ui.Colour.green),
                ],
            ),
        ],
        is_collapsed=True,
    )

    async def setup(self):
        storage_curve = self.config.storage_curve.elements
        show_volume = len(storage_curve) > 0

        if show_volume:
            max_depth = self.config.full_rl.value - self.config.empty_rl.value
            min_vol = get_volume(0, storage_curve)
            low_vol = get_volume(max_depth * 0.4, storage_curve)
            high_vol = get_volume(max_depth * 0.8, storage_curve)
            max_vol = get_volume(max_depth, storage_curve)

            self.last_volume.ranges = [
                ui.Range("Low", min_vol, low_vol, colour=ui.Colour.yellow),
                ui.Range("Half", low_vol, high_vol, colour=ui.Colour.blue),
                ui.Range("Full", high_vol, max_vol, colour=ui.Colour.green),
            ]
            self.last_level.hidden = True
        else:
            self.last_volume.hidden = True
