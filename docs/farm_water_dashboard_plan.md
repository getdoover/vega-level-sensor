# Farm Water Monitoring Dashboard Plan

Reference: [FILL: Power Management Project link]

Local comparison project: `~/Documents/doover/power-management`

## Goal

Build a simple farm water monitoring dashboard that follows the Solar Power Dashboard structure from the Power Management Project:

- A processor-hosted dashboard app.
- A Doover `RemoteComponent` for the interactive dashboard.
- Extended permissions for the devices the dashboard can read.
- A top graph for farm-wide water capacity over time.
- A device list with row-click drill-down.
- A detail window with the selected dam/device capacity history and device navigation buttons.

## Components

1. `farm_water_dashboard` processor app
   - Hosts the dashboard UI schema.
   - Grants read access to selected devices through extended permissions.
   - Keeps the dashboard agent connection visible when deployed.
   - Does not perform per-device calculations server side.

2. `WaterCapacityDashboardWidget` remote component
   - Reads the dashboard `DEVICE_MAP`.
   - Reads current `tag_values` aggregates for each dam/device running the Vega Level Sensor app.
   - Reads recent `tag_values` messages to build per-device capacity histories from the Vega `last_volume` tag.
   - Builds the farm-wide capacity graph from the sum of per-device Vega capacity histories.
   - Renders a compact dashboard with summary cards, the farm graph, and a sortable list.
   - Opens a quick-view dialog on row click.

3. Device-level view
   - The quick view displays selected dam/device capacity over time.
   - The quick view includes a button to open the Doover device page.
   - The quick view syncs the selected row to `?device=<device_id>` so the view can be reopened directly.

## Data Model

Dashboard config:

| Field | Purpose |
| --- | --- |
| `default_history_days` | Default time window for graphs and list trends. |
| `extended_permissions` | Devices the dashboard can read. Configure Apps Installed or explicit devices. |

Per-device fields supplied through extended permissions:

| Field | Purpose |
| --- | --- |
| `app_installs.name` | Installed app key used as the `tag_values` subtree. |
| `app_installs.application_name` | Used to identify devices running `vega_level_sensor`. |
| `type.name` | Device type label for filtering/display. |
| `id`, `name`, `display_name` | Device identity and display labels. |

Runtime row model:

| Field | Purpose |
| --- | --- |
| `id` | Device id used for navigation and deep links. |
| `displayName` | Dam/device label in the list. |
| `vegaAppKey` | Installed Vega app key used to read `<vegaAppKey>.last_volume`. |
| `capacity` | Latest known capacity value. |
| `history` | Recent capacity points over the configured period. |
| `change` | Difference between first and latest point in the period. |
| `lastUpdated` | Latest aggregate/message timestamp. |

## UI Layout

1. Header row
   - Title: `Farm Water`
   - Summary chips: number of devices, latest farm capacity, devices with detected Vega app installs.

2. Top graph
   - `Farm Water Capacity`
   - Line chart over the selected period.
   - Sums per-device Vega `last_volume` histories.

3. Device list
   - Columns: dam/device, current capacity, period change, last update.
   - Sortable by device name, current capacity, change, and last update.
   - Rows are clickable and use the same table interaction pattern as the Power Management dashboard.

4. Quick view dialog
   - Opens from row click.
   - Shows selected dam/device name, latest capacity, change, and last update.
   - Shows a line chart for that dam/device over time.
   - Includes `Open device page`.

## Interaction Flow

1. User opens the farm water dashboard.
2. Widget reads `DEVICE_MAP` for devices and detects each installed `vega_level_sensor` app key.
3. Widget fetches live `tag_values` aggregates for current `<vega_app_key>.last_volume` values.
4. Widget fetches recent `tag_values` messages for graph/list history.
5. User sorts the list or scans current values.
6. User clicks a dam/device row.
7. Quick view opens and writes `?device=<device_id>` into the URL.
8. User selects a navigation button to inspect the actual device.
9. Closing the quick view removes the `device` query parameter.

## Placeholder Integration Points

Use these placeholders until real deployment values are known:

- Per-device capacity source: `<vega_app_key>.last_volume`
- Device selection: `extended_permissions`

## Acceptance Checklist

- [x] Plan created outlining components, data models, and UI/UX flows.
- [x] Graph at top showing farm-wide water capacity over time.
- [x] List of dams/devices with water capacity over time.
- [x] Row click opens quick view with per-dam/device water capacity over time.
- [x] Quick view includes buttons to navigate to the actual device.
- [x] Implementation aligned with Power Management Project styling and interactions.
- [x] Placeholder link to Power Management Project included.
