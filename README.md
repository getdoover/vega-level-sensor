
# Vega Level Sensor

<img src="https://doover.com/wp-content/uploads/Doover-Logo-Landscape-Navy-padded-small.png" alt="App Icon" style="max-width: 300px;">

**Doover application for monitoring water level with Vega level sensors**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/getdoover/vega-level-sensor)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/getdoover/vega-level-sensor/blob/main/LICENSE)

[Getting Started](#getting-started) • [Configuration](#configuration) • [Developer](https://github.com/getdoover/vega-level-sensor/blob/main/DEVELOPMENT.md) • [Need Help?](#need-help)

<br/>

## Overview

This application connects to Vega level sensors via Modbus to provide real-time water level monitoring with optional volume calculation using configurable storage curves.

Key capabilities:

- **Level monitoring** -- reads sensor distance and calculates water reference level (RL) in metres
- **Volume calculation** -- converts level to volume using a configurable storage curve with linear interpolation, or displays as percentage if no curve is configured
- **Comms tracking** -- detects communication loss with the sensor and clears stale readings after a 2-minute timeout
- **Event tracking** -- start/stop events to record water volume changes over a period, with report publishing to the `report_requests` channel
- **Adaptive UI** -- automatically switches between stacked and submodule UI layout when multiple sensors are deployed on the same device

<br/>

## Getting Started

This Doover App can be managed via the Doover CLI and installed onto devices through the Doover platform.

### Configuration

| Setting | Description | Default |
|---------|-------------|---------|
| **Sensor RL** | Sensor reference level in metres | *required* |
| **Full RL** | Full tank reference level in metres | *required* |
| **Empty RL** | Empty tank reference level in metres | *required* |
| **Modbus ID** | Device ID on the Modbus network | *required* |
| **Storage Curve** | Array of level/volume points for volume interpolation | `[]` (shows % instead) |
| **Modbus Config** | Modbus connection settings (bus type, serial/TCP parameters) | serial defaults |

<br/>

## Integrations

### Channels

| Channel | Description |
|---------|-------------|
| **report_requests** | Publishes event report requests with period boundaries and timezone |

### Dependencies

- **Modbus Interface** (`doover_modbus_iface`) -- provides the Modbus RTU/TCP bridge

<br/>

### Need Help?

- Email: support@doover.com
- [Doover Documentation](https://docs.doover.com)
- [Developer Guide](https://github.com/getdoover/vega-level-sensor/blob/main/DEVELOPMENT.md)

<br/>

## Version History

### v1.0.0 (Current)
- Initial release
- Real-time level monitoring via Modbus
- Storage curve volume interpolation
- Event tracking with report publishing
- Comms loss detection

<br/>

## License

This app is licensed under the [Apache License 2.0](https://github.com/getdoover/vega-level-sensor/blob/main/LICENSE).
