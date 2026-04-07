# Vega Level Sensor -- Development Guide

## Repository Structure

```
README.md                   <-- User-facing app description
DEVELOPMENT.md              <-- This file
pyproject.toml              <-- Python project config and dependencies
Dockerfile                  <-- Production Docker image
doover_config.json          <-- Doover platform metadata (generated)

src/vega_level_sensor/
  __init__.py               <-- Entry point (main function)
  application.py            <-- Core application logic and event handlers
  app_config.py             <-- Configuration schema (sensor RL, storage curve, etc.)
  app_tags.py               <-- Declarative tags (display state, event tracking)
  app_ui.py                 <-- UI definition (level gauge, event buttons, sensor details)
  app_state.py              <-- State machine (comms / maybe_no_comms / no_comms)
  record.py                 <-- Modbus register parser + storage curve interpolation

simulators/
  app_config.json           <-- Sample config for local development
  docker-compose.yml        <-- Orchestrates device agent, modbus interface, simulator, and app
  vega_sim/
    main.py                 <-- Modbus TCP server emulating a Vega sensor
    pyproject.toml          <-- Simulator dependencies
    Dockerfile              <-- Simulator Docker image

tests/
  test_imports.py           <-- Import and basic validation tests
```

## Prerequisites

- Python 3.11+
- [uv](https://docs.astral.sh/uv/) package manager
- Docker and Docker Compose (for simulator and deployment)

## Getting Started

### Install dependencies

```bash
uv sync
```

### Run locally (with simulator)

```bash
cd simulators
docker compose up --build
```

This starts four services:

| Service | Description |
|---------|-------------|
| `device_agent` | Doover device agent |
| `modbus_iface` | Modbus RTU/TCP bridge |
| `vega_sim` | Vega sensor simulator (TCP on port 5020, oscillating distance) |
| `application` | This app, reading from the simulator |

### Run tests

```bash
uv run pytest tests/
```

## Architecture

### Data Flow

```
Vega Sensor  -->  Modbus (RTU/TCP)  -->  modbus_iface  -->  Application  -->  Doover Platform
                                                               |
                                                               +--> Tags (display state)
                                                               +--> Channels (event reports)
                                                               +--> UI (dashboard)
```

### Modbus Registers

The app reads 18 holding registers (type 3) starting at register 100.

| Register (offset) | Description | Format |
|-------------------|-------------|--------|
| 10-11 | Sensor distance | Little-endian float32 (metres) |
| 14-15 | Measurement reliability | Little-endian float32 (dB) |

### State Machine (Comms Tracking)

| State | Description | Timeout |
|-------|-------------|---------|
| `no_comms` | No communication with sensor (initial state) | -- |
| `comms` | Active communication | -- |
| `maybe_no_comms` | Failed read, waiting to confirm loss | 2 min |

Successful read transitions to `comms`. Failed read from `comms` transitions to `maybe_no_comms`. After 2 minutes without recovery, transitions to `no_comms` and clears display.

### Storage Curve

The storage curve maps water depth (metres) to volume (megs) using linear interpolation. Configure it as an array of `{level, volume}` points in the config. If no curve is configured, the UI shows level as a percentage instead.

### Event Tracking

Users can start/stop events via UI buttons. Starting an event records the initial volume. Stopping publishes a report request to the `report_requests` channel with `period_from`, `period_to`, and `timezone`.

## Regenerating doover_config.json

```bash
uv run export-config
```

## Building the Docker Image

```bash
docker build -t vega-level-sensor .
```
