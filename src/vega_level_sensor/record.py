import struct
import time
import logging

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .app_config import VegaLevelSensorConfig

log = logging.getLogger()


def get_volume(level: float, storage_curve) -> float | None:
    """Transform a level in metres to a volume in megs using the storage curve.

    Uses linear interpolation within the curve and extrapolation beyond it.
    """
    if not storage_curve:
        return None

    curve = {}
    for point in storage_curve:
        curve[point.level.value] = point.volume.value

    sorted_levels = sorted(float(l) for l in curve.keys())
    sorted_keys = sorted(curve.keys())

    # Interpolation within the range
    for i in range(len(sorted_levels) - 1):
        if sorted_levels[i] <= level <= sorted_levels[i + 1]:
            x1, y1 = sorted_levels[i], curve[sorted_keys[i]]
            x2, y2 = sorted_levels[i + 1], curve[sorted_keys[i + 1]]
            result = y1 + (level - x1) * (y2 - y1) / (x2 - x1)
            return round(result, 1)

    # Extrapolation outside the range
    if level < sorted_levels[0]:
        x1, y1 = sorted_levels[0], curve[sorted_keys[0]]
        x2, y2 = sorted_levels[1], curve[sorted_keys[1]]
    else:
        x1, y1 = sorted_levels[-2], curve[sorted_keys[-2]]
        x2, y2 = sorted_levels[-1], curve[sorted_keys[-1]]

    result = y1 + (level - x1) * (y2 - y1) / (x2 - x1)
    return round(result, 1)


class Record:
    def __init__(self, register_values: list[int], config: "VegaLevelSensorConfig"):
        self.register_values = register_values
        self.ts = time.time()
        self.config = config

    @property
    def sensor_distance(self) -> float | None:
        """Sensor distance in metres (little-endian float32 from registers 10-11)."""
        word1 = self.register_values[10]
        word2 = self.register_values[11]
        result = struct.unpack("f", struct.pack("<HH", word1, word2))[0]
        if result is None:
            return None
        return round(result, 3)

    @property
    def measurement_reliability(self) -> float:
        """Measurement reliability in dB (little-endian float32 from registers 14-15)."""
        word1 = self.register_values[14]
        word2 = self.register_values[15]
        return struct.unpack("f", struct.pack("<HH", word1, word2))[0]

    @property
    def rl_reading(self) -> float:
        """Water reference level in metres."""
        return self.config.sensor_rl.value - self.sensor_distance

    @property
    def level_percentage(self) -> float:
        """Level as a percentage of tank capacity."""
        reading = self.rl_reading - self.config.empty_rl.value
        sensor_range = self.config.full_rl.value - self.config.empty_rl.value
        return (reading / sensor_range) * 100

    @property
    def output_volume(self) -> float | None:
        """Volume in megs based on the storage curve, or None if no curve configured."""
        if len(self.config.storage_curve.elements) > 0:
            return get_volume(
                self.rl_reading - self.config.empty_rl.value,
                self.config.storage_curve.elements,
            )
        return None
