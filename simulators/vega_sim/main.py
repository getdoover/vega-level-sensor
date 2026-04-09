"""A module to simulate a Vega level sensor via Modbus TCP."""

import asyncio
import logging
import os
import random
import struct
import time

from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusServerContext,
    ModbusSlaveContext,
)
from pymodbus.device import ModbusDeviceIdentification
from pymodbus.server import StartAsyncTcpServer

from transitions import Machine, State

log = logging.getLogger()

SLEEP_TIME = 120
INIT_TIME = 5


def add_noise(in_num, stdev: float):
    return in_num + ((random.random() - 0.5) * stdev)


def split_i32(value: int):
    high_16 = (value >> 16) & 0xFFFF
    low_16 = value & 0xFFFF
    return high_16, low_16


def split_f32(value: float):
    float_bytes = struct.pack(">f", value)
    float_int = struct.unpack(">I", float_bytes)[0]
    return split_i32(float_int)


class CustomSlaveContext(ModbusSlaveContext):
    def __init__(self, on_read_callback, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_read_callback = on_read_callback

    def getValues(self, fx, address, count=1):
        self.on_read_callback()
        return super().getValues(fx, address, count)


class VegaSensorSim:
    states = [
        State(name="sleeping", on_enter=["save_current_state_enter_time"]),
        State(name="awake_init", on_enter=["save_current_state_enter_time"]),
        State(name="awake_rt", on_enter=["save_current_state_enter_time"]),
    ]

    transitions = [
        {"trigger": "awaken", "source": "sleeping", "dest": "awake_init"},
        {"trigger": "initialised", "source": "awake_init", "dest": "awake_rt"},
        {"trigger": "goto_sleep", "source": "awake_rt", "dest": "sleeping"},
    ]

    def __init__(self, device_id, host, port, min_distance, max_distance):
        self.device_id = device_id
        self.host = host
        self.port = port

        self.sensor_distance_reg = 10
        self.measurement_reliability_reg = 14

        self.min_distance = min_distance
        self.max_distance = max_distance
        self.current_reliability = 22.0
        self.current_distance = self.min_distance

        self.last_context_read = None
        self.context = None
        self.is_ready = asyncio.Event()

        self.setup_state_machine()

    def setup_state_machine(self):
        self.sm = Machine(
            model=self,
            states=self.states,
            transitions=self.transitions,
            initial="sleeping",
        )

    def save_current_state_enter_time(self):
        self.current_state_enter_time = time.time()

    def get_time_in_state(self):
        return time.time() - self.current_state_enter_time

    def on_read_callback(self):
        self.last_context_read = time.time()

    async def start_modbus_server(self):
        store = self.context = CustomSlaveContext(
            on_read_callback=self.on_read_callback,
            di=ModbusSequentialDataBlock(0x00, [17] * 100),
            co=ModbusSequentialDataBlock(0x00, [17] * 100),
            hr=ModbusSequentialDataBlock(0x00, [0] * 100),
            ir=ModbusSequentialDataBlock(0x00, [17] * 100),
        )

        context = ModbusServerContext(slaves=store, single=True)
        identity = ModbusDeviceIdentification(
            info_name={
                "VendorName": "Doover",
                "ProductCode": "VEGASIM",
                "VendorUrl": "https://doover.com",
                "ProductName": "Vega Sensor Simulator",
                "ModelName": "Vega Sensor",
                "MajorMinorRevision": "1.0.0",
            }
        )

        self.is_ready.set()
        return await StartAsyncTcpServer(
            context=context,
            identity=identity,
            address=(self.host, self.port),
            framer="socket",
        )

    def set_register(self, reg, value):
        return self.context.setValues(0x03, reg, [int(value)])

    def split_and_set_f32(self, reg, value):
        high, low = split_f32(value)
        self.set_register(reg, high)
        self.set_register(reg + 1, low)

    def generate_output_values(self):
        if self.state != "awake_rt":
            for reg in (self.sensor_distance_reg, self.measurement_reliability_reg):
                self.split_and_set_f32(reg, 0)
            return

        self.current_distance += (self.max_distance - self.min_distance) * 0.01
        if self.current_distance > self.max_distance:
            self.current_distance = self.min_distance

        self.split_and_set_f32(
            self.sensor_distance_reg, add_noise(self.current_distance, 0.1)
        )
        self.split_and_set_f32(
            self.measurement_reliability_reg, add_noise(self.current_reliability, 0.5)
        )

    async def main_loop(self):
        self.generate_output_values()
        log.info(f"{time.time()} - {self.state} - Distance={self.current_distance}")

        match self.state:
            case "awake_rt":
                if self.last_context_read is not None:
                    self.last_context_read = None
                    self.save_current_state_enter_time()
                if self.get_time_in_state() > SLEEP_TIME:
                    self.goto_sleep()
                    self.last_context_read = None
            case "awake_init":
                if self.get_time_in_state() > INIT_TIME:
                    self.initialised()
            case "sleeping":
                if self.last_context_read is not None:
                    self.last_context_read = None
                    self.awaken()

    async def run(self):
        errors = 0
        log.info("Starting...")
        t = asyncio.create_task(self.start_modbus_server())

        while True:
            if t.done():
                raise RuntimeError("Modbus server failed.")

            await self.is_ready.wait()
            try:
                await self.main_loop()
                errors = 0
            except Exception as e:
                errors += 1
                if errors > 5:
                    log.error("Too many errors, exiting.")
                    break
                log.error(f"Error in main loop: {e}. Sleeping and retrying...")
                await asyncio.sleep(5)
            else:
                await asyncio.sleep(1)


if __name__ == "__main__":
    sim = VegaSensorSim(
        int(os.environ.get("DEVICE_ID", 1)),
        os.environ.get("MODBUS_HOST", "127.0.0.1"),
        int(os.environ.get("MODBUS_PORT", 5020)),
        float(os.environ.get("MIN_DISTANCE", 3.0)),
        float(os.environ.get("MAX_DISTANCE", 10.0)),
    )
    logging.basicConfig(
        level=logging.DEBUG if os.environ.get("DEBUG") == "1" else logging.INFO
    )
    asyncio.run(sim.run())
