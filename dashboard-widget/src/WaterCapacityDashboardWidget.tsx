import "./styles.css";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";

import RemoteComponentWrapper from "customer_site/RemoteComponentWrapper";
import { useRemoteParams } from "customer_site/useRemoteParams";

import {
  useAgentChannel,
  useDeviceMap,
  useDooverClient,
  useMultiAgentAggregates,
  useMultiAgentChannelMessages,
  type DeviceMapEntry,
} from "doover-js/react";
import { extractSnowflakeId, generateSnowflakeIdAtTime } from "doover-js";
import { useQuery } from "@tanstack/react-query";

import dayjs from "dayjs";
import localizedFormat from "dayjs/plugin/localizedFormat";
import relativeTime from "dayjs/plugin/relativeTime";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Maximize2,
  X,
} from "lucide-react";

dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);

const DAY_MS = 86_400_000;
const DEFAULT_HISTORY_DAYS = 7;
const MAX_HISTORY_DAYS = 30;
const FLEET_MSG_CEILING = 50_000;
const DEFAULT_AGENT_MSG_LIMIT = 500;
const VEGA_APP_NAME = "vega_level_sensor";
const VEGA_CAPACITY_TAG = "last_volume";
const STACK_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0891b2",
  "#be123c",
  "#4d7c0f",
  "#9333ea",
  "#0f766e",
];
const RANGE_OPTIONS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
];

interface UiRemoteComponentWater {
  app_key: string;
}

interface WaterDeviceEntry extends DeviceMapEntry {
  id: string;
  name?: string | null;
  display_name?: string | null;
  app_installs?: {
    name?: string | null;
    display_name?: string | null;
    application_name?: string | null;
  }[];
  type?: {
    name?: string | null;
  } | null;
}

interface DashboardDeploymentConfig {
  applications?: Record<
    string,
    {
      default_history_days?: number | string | null;
    }
  >;
}

interface TagAggregate {
  data?: Record<string, unknown> | null;
  last_updated?: number | string | null;
}

interface ChannelMessage {
  id?: string | number | null;
  timestamp?: number | string | null;
  data?: unknown;
  channel?: {
    agent_id?: string | number | null;
  } | null;
}

interface DataSeriesResult {
  value?: unknown;
  message_id?: string | number | null;
  id?: string | number | null;
  timestamp?: number | string | null;
}

interface DataSeriesResponse {
  results?: DataSeriesResult[];
}

interface CapacityPoint {
  t: number;
  value: number;
}

interface StackedCapacitySeries {
  key: string;
  name: string;
  color: string;
}

interface StackedCapacityData {
  data: Array<Record<string, number | string>>;
  series: StackedCapacitySeries[];
}

interface DeviceRow {
  id: string;
  name: string;
  displayName: string;
  deviceTypeName: string | null;
  chartColor: string;
  vegaAppKey: string | null;
  capacity: number | null;
  lastUpdated: number | null;
  history: CapacityPoint[];
  change: number | null;
}

type SortKey = "name" | "capacity" | "change" | "lastUpdated";
type SortDir = "asc" | "desc";

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toEpochMs(value: unknown): number | null {
  const n = num(value);
  return n != null && n > 0 ? n : null;
}

function displayNameOf(device: WaterDeviceEntry): string {
  return device.display_name || device.name || device.id;
}

function isVegaInstall(install: NonNullable<WaterDeviceEntry["app_installs"]>[number]): boolean {
  const values = [install.name, install.display_name, install.application_name]
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.toLowerCase());
  return values.some(
    (v) =>
      v === VEGA_APP_NAME ||
      v.startsWith(`${VEGA_APP_NAME}_`) ||
      v.startsWith(`${VEGA_APP_NAME}-`) ||
      v.includes("vega level sensor"),
  );
}

function vegaAppKeyOf(device: WaterDeviceEntry): string | null {
  const install = device.app_installs?.find(isVegaInstall);
  return typeof install?.name === "string" && install.name.trim()
    ? install.name.trim()
    : null;
}

function capacityPathFor(appKey: string | null): string | null {
  return appKey ? `${appKey}.${VEGA_CAPACITY_TAG}` : null;
}

function tagNameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split(".");
  return parts[parts.length - 1] ?? null;
}

function resolveDottedNumber(source: unknown, path: string | null | undefined): number | null {
  if (!path || source == null || typeof source !== "object") return null;
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return num(current);
}

function resolveCapacityNumber(source: unknown, path: string | null | undefined): number | null {
  const direct = num(source);
  if (direct != null) return direct;
  if (!path || source == null || typeof source !== "object") return null;

  const record = source as Record<string, unknown>;
  const dotted = resolveDottedNumber(record, path);
  if (dotted != null) return dotted;

  const flattened = num(record[path]);
  if (flattened != null) return flattened;

  const tagName = tagNameFromPath(path);
  return tagName ? num(record[tagName]) : null;
}

function timestampFromSnowflake(id: unknown): number | null {
  if (typeof id !== "string" && typeof id !== "number") return null;
  try {
    return extractSnowflakeId(String(id)).timestamp;
  } catch {
    return null;
  }
}

function capacityAt(points: CapacityPoint[], t: number): number | null {
  let latest: CapacityPoint | null = null;
  for (const p of points) {
    if (p.t > t) break;
    latest = p;
  }
  return latest?.value ?? null;
}

function latestChange(points: CapacityPoint[]): number | null {
  if (points.length < 2) return null;
  return points[points.length - 1].value - points[0].value;
}

function filterPoints(points: CapacityPoint[], days: number): CapacityPoint[] {
  const cutoff = Date.now() - Math.max(1, days) * DAY_MS;
  return points.filter((p) => p.t >= cutoff);
}

function chartCapacity(value: number | null): number {
  return Math.max(0, value ?? 0);
}

function buildFarmSeries(rows: DeviceRow[], farmHistory: CapacityPoint[], days: number): CapacityPoint[] {
  const configuredFarm = filterPoints(farmHistory, days);
  if (configuredFarm.length > 0) return configuredFarm;

  const histories = rows
    .map((r) => filterPoints(r.history, days))
    .filter((h) => h.length > 0);
  if (histories.length === 0) return [];

  const timestamps = [...new Set(histories.flatMap((h) => h.map((p) => p.t)))].sort(
    (a, b) => a - b,
  );
  return timestamps.map((t) => {
    let total = 0;
    for (const h of histories) {
      total += chartCapacity(capacityAt(h, t));
    }
    return { t, value: total };
  });
}

function buildStackedFarmData(rows: DeviceRow[], days: number): StackedCapacityData {
  const seriesRows = rows
    .map((row, index) => ({
      key: `device_${index}`,
      name: row.displayName,
      color: row.chartColor,
      history: filterPoints(row.history, days),
    }))
    .filter((row) => row.history.length > 0);

  if (seriesRows.length === 0) return { data: [], series: [] };

  const timestamps = [...new Set(seriesRows.flatMap((row) => row.history.map((p) => p.t)))].sort(
    (a, b) => a - b,
  );

  const data = timestamps.map((t) => {
    const point: Record<string, number | string> = {
      t,
      label: dayjs(t).format("D MMM HH:mm"),
    };
    for (const row of seriesRows) {
      point[row.key] = chartCapacity(capacityAt(row.history, t));
    }
    return point;
  });

  return {
    data,
    series: seriesRows.map(({ key, name, color }) => ({ key, name, color })),
  };
}

function mergeHistory(primary: CapacityPoint[], fallback: CapacityPoint[]): CapacityPoint[] {
  if (primary.length === 0) return fallback;
  if (fallback.length === 0) return primary;

  const byTimestamp = new Map<number, CapacityPoint>();
  for (const p of fallback) byTimestamp.set(p.t, p);
  for (const p of primary) byTimestamp.set(p.t, p);
  return [...byTimestamp.values()].sort((a, b) => a.t - b.t);
}

function fmtCapacity(value: number | null): string {
  if (value == null) return "-";
  if (Math.abs(value) >= 100) return `${value.toFixed(0)} ML`;
  if (Math.abs(value) >= 10) return `${value.toFixed(1)} ML`;
  return `${value.toFixed(2)} ML`;
}

function fmtChange(value: number | null): string {
  if (value == null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${fmtCapacity(value)}`;
}

function fmtTime(value: number | null): string {
  if (value == null) return "-";
  return dayjs(value).fromNow();
}

function sortRows(rows: DeviceRow[], key: SortKey, dir: SortDir): DeviceRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    if (key === "name") return a.displayName.localeCompare(b.displayName) * factor;
    const av = a[key] ?? Number.NEGATIVE_INFINITY;
    const bv = b[key] ?? Number.NEGATIVE_INFINITY;
    return (av - bv) * factor;
  });
  return sorted;
}

function SortHeader({
  label,
  sortKey,
  current,
  dir,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <th>
      <button type="button" onClick={() => onSort(sortKey)}>
        {label}
        {active ? dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : null}
      </button>
    </th>
  );
}

function CapacityChart({
  title,
  points,
  emptyLabel,
}: {
  title: string;
  points: CapacityPoint[];
  emptyLabel: string;
}) {
  const data = points.map((p) => ({
    t: p.t,
    label: dayjs(p.t).format("D MMM HH:mm"),
    value: p.value,
  }));

  return (
    <div className="water-panel">
      <div className="water-panel-header">
        <span className="water-panel-title">{title}</span>
        <span className="water-muted">{points.length} points</span>
      </div>
      <div className="water-chart">
        {data.length === 0 ? (
          <div className="water-empty">{emptyLabel}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 18, bottom: 4, left: 2 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tickFormatter={(t) => dayjs(t).format("D MMM")}
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                type="number"
                domain={["dataMin", "dataMax"]}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => `${v}`}
                width={42}
              />
              <Tooltip
                labelFormatter={(label) => dayjs(Number(label)).format("ddd, LLL")}
                formatter={(value) => [fmtCapacity(num(value)), "Capacity"]}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
              />
              <Line
                dataKey="value"
                dot={false}
                isAnimationActive={false}
                name="Capacity"
                stroke="var(--primary)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function FarmCapacityChart({
  title,
  rows,
  days,
  onDaysChange,
  emptyLabel,
}: {
  title: string;
  rows: DeviceRow[];
  days: number;
  onDaysChange: (days: number) => void;
  emptyLabel: string;
}) {
  const { data, series } = useMemo(() => buildStackedFarmData(rows, days), [rows, days]);

  return (
    <div className="water-panel">
      <div className="water-panel-header">
        <span className="water-panel-title">{title}</span>
        <div className="water-range-group" aria-label="Timeline length">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.days}
              className="water-range-button"
              type="button"
              onClick={() => onDaysChange(option.days)}
              aria-pressed={days === option.days}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className="water-chart">
        {data.length === 0 ? (
          <div className="water-empty">{emptyLabel}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 18, bottom: 4, left: 2 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
              <XAxis
                dataKey="t"
                tickFormatter={(t) => dayjs(Number(t)).format("D MMM")}
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                type="number"
                domain={["dataMin", "dataMax"]}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => fmtCapacity(num(v))}
                width={52}
              />
              <Tooltip
                labelFormatter={(label) => dayjs(Number(label)).format("ddd, LLL")}
                formatter={(value, name) => [fmtCapacity(num(value)), name]}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  color: "var(--popover-foreground)",
                  fontSize: 12,
                }}
              />
              {series.map((item) => (
                <Area
                  key={item.key}
                  dataKey={item.key}
                  fill={item.color}
                  fillOpacity={0.62}
                  isAnimationActive={false}
                  name={item.name}
                  stackId="capacity"
                  stroke={item.color}
                  strokeWidth={1.5}
                  type="monotone"
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Summary({ rows, farmSeries }: { rows: DeviceRow[]; farmSeries: CapacityPoint[] }) {
  const latestFarm = farmSeries.length ? farmSeries[farmSeries.length - 1].value : null;
  const currentTotal = rows.reduce((sum, r) => sum + chartCapacity(r.capacity), 0);
  const hasConfiguredDevice = rows.some((r) => r.vegaAppKey);
  const shownTotal = latestFarm ?? (hasConfiguredDevice ? currentTotal : null);

  return (
    <div className="water-summary">
      <span className="water-chip">
        Devices <strong>{rows.length}</strong>
      </span>
      <span className="water-chip">
        Farm capacity <strong>{fmtCapacity(shownTotal)}</strong>
      </span>
    </div>
  );
}

function DeviceTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  onOpen,
}: {
  rows: DeviceRow[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onOpen: (row: DeviceRow) => void;
}) {
  return (
    <div className="water-panel">
      <div className="water-panel-header">
        <span className="water-panel-title">Storage Devices</span>
      </div>
      <div className="water-list-wrap">
        <table className="water-table">
          <thead>
            <tr>
              <SortHeader label="Dam / Device" sortKey="name" current={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Capacity" sortKey="capacity" current={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Change" sortKey="change" current={sortKey} dir={sortDir} onSort={onSort} />
              <SortHeader label="Updated" sortKey="lastUpdated" current={sortKey} dir={sortDir} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="water-empty" colSpan={4}>
                  No devices found. Configure extended permissions for devices running Vega Level Sensor.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} onClick={() => onOpen(row)}>
                  <td>
                    <span className="water-device-cell">
                      <span className="water-device-color" style={{ backgroundColor: row.chartColor }} aria-hidden="true" />
                      <span className="water-device-name">
                        <strong title={row.displayName}>{row.displayName}</strong>
                        <span className="water-muted">{row.deviceTypeName || row.id}</span>
                      </span>
                    </span>
                  </td>
                  <td>{fmtCapacity(row.capacity)}</td>
                  <td className={row.change != null && row.change < 0 ? "water-negative" : "water-positive"}>
                    {fmtChange(row.change)}
                  </td>
                  <td title={row.lastUpdated ? dayjs(row.lastUpdated).format("ddd, LLL") : undefined}>
                    {fmtTime(row.lastUpdated)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeviceQuickView({
  row,
  days,
  onClose,
}: {
  row: DeviceRow | null;
  days: number;
  onClose: () => void;
}) {
  if (!row) return null;

  return createPortal(
    <>
      <div className="water-overlay" onClick={onClose} />
      <div className="water-dialog" role="dialog" aria-modal="true" aria-labelledby="water-dialog-title">
        <div className="water-dialog-header">
          <div>
            <h2 id="water-dialog-title" className="water-dialog-title">
              {row.displayName}
            </h2>
            <div className="water-muted">{row.deviceTypeName || row.id}</div>
          </div>
          <button className="water-dialog-close" type="button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="water-detail-stats">
          <div className="water-stat">
            <span>Capacity</span>
            <strong>{fmtCapacity(row.capacity)}</strong>
          </div>
          <div className="water-stat">
            <span>Change</span>
            <strong className={row.change != null && row.change < 0 ? "water-negative" : "water-positive"}>
              {fmtChange(row.change)}
            </strong>
          </div>
          <div className="water-stat">
            <span>Updated</span>
            <strong>{fmtTime(row.lastUpdated)}</strong>
          </div>
        </div>

        <CapacityChart
          title={`${row.displayName} Capacity`}
          points={filterPoints(row.history, days)}
          emptyLabel="No capacity history for this dam/device yet."
        />

        <div className="water-detail-actions">
          <Link className="water-button water-button-primary" to={`/agent/${row.id}`} onClick={onClose}>
            <ExternalLink size={14} />
            Open device page
          </Link>
        </div>
      </div>
    </>,
    document.body,
  );
}

function FullscreenDialog({
  rows,
  tableRows,
  farmSeries,
  days,
  onDaysChange,
  sortKey,
  sortDir,
  onSort,
  onOpen,
  onClose,
}: {
  rows: DeviceRow[];
  tableRows: DeviceRow[];
  farmSeries: CapacityPoint[];
  days: number;
  onDaysChange: (days: number) => void;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  onOpen: (row: DeviceRow) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="water-fullscreen" role="dialog" aria-modal="true" aria-labelledby="water-fullscreen-title">
      <div className="water-fullscreen-header">
        <div>
          <h2 id="water-fullscreen-title" className="water-dialog-title">
            Farm Water Capacity
          </h2>
          <div className="water-muted">Fleet storage overview</div>
        </div>
        <button className="water-dialog-close" type="button" onClick={onClose} aria-label="Close fullscreen">
          <X size={16} />
        </button>
      </div>

      <div className="water-fullscreen-content">
        <Summary rows={rows} farmSeries={farmSeries} />
        <FarmCapacityChart
          title="Farm Water Capacity"
          rows={rows}
          days={days}
          onDaysChange={onDaysChange}
          emptyLabel="No capacity history yet. Configure extended permissions for devices running Vega Level Sensor."
        />
        <DeviceTable
          rows={tableRows}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          onOpen={onOpen}
        />
      </div>
    </div>,
    document.body,
  );
}

function WaterCapacityDashboardWidgetInner({ uiElement }: { uiElement: UiRemoteComponentWater }) {
  const client = useDooverClient();
  const params = useRemoteParams();
  const agentId = params?.agentId == null ? undefined : String(params.agentId);
  const dashboardAppKey = uiElement?.app_key ?? "";

  const { data: deploymentConfig } = useAgentChannel<DashboardDeploymentConfig>(
    agentId,
    "deployment_config",
  );
  const dashboardConfig = deploymentConfig?.applications?.[dashboardAppKey] ?? {};
  const configuredDays = Math.min(
    MAX_HISTORY_DAYS,
    Math.max(1, num(dashboardConfig.default_history_days) ?? DEFAULT_HISTORY_DAYS),
  );

  const [rangeDays, setRangeDays] = useState(configuredDays);
  useEffect(() => setRangeDays(configuredDays), [configuredDays]);

  const { devices, isLoading: devicesLoading } = useDeviceMap<WaterDeviceEntry>(
    agentId,
    dashboardAppKey,
  );
  const deviceIds = useMemo(() => devices.map((d) => d.id), [devices]);

  const vegaAppKeyByDevice = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const d of devices) {
      const appKey = vegaAppKeyOf(d);
      if (appKey) out[d.id] = appKey;
    }
    return out;
  }, [devices]);

  const fieldRoots = useMemo(() => [...new Set(Object.values(vegaAppKeyByDevice))], [vegaAppKeyByDevice]);
  const capacityFields = useMemo(
    () => [...new Set(Object.values(vegaAppKeyByDevice).map((appKey) => capacityPathFor(appKey)).filter((v): v is string => !!v))],
    [vegaAppKeyByDevice],
  );

  const { aggregatesByAgent, query: aggregateQuery } = useMultiAgentAggregates<TagAggregate>(
    "tag_values",
    deviceIds,
    { fields: fieldRoots },
  );

  const fleetTop = useMemo(() => Date.now() + 60_000, []);
  const before = useMemo(() => generateSnowflakeIdAtTime(fleetTop), [fleetTop]);
  const after = useMemo(
    () => generateSnowflakeIdAtTime(fleetTop - MAX_HISTORY_DAYS * DAY_MS),
    [fleetTop],
  );
  const historyAgentIds = useMemo(
    () => devices.filter((d) => vegaAppKeyByDevice[d.id]).map((d) => d.id),
    [devices, vegaAppKeyByDevice],
  );
  const agentMessageLimit = useMemo(
    () =>
      historyAgentIds.length > 0
        ? Math.max(1, Math.min(DEFAULT_AGENT_MSG_LIMIT, Math.floor(FLEET_MSG_CEILING / historyAgentIds.length)))
        : DEFAULT_AGENT_MSG_LIMIT,
    [historyAgentIds.length],
  );
  const historyQuery = useMultiAgentChannelMessages<ChannelMessage>(
    "tag_values",
    historyAgentIds,
    {
      initialBefore: before,
      after,
      agentMessageLimit,
      fields: fieldRoots,
      liveUpdates: false,
    },
  );

  const timeseriesQuery = useQuery({
    queryKey: [
      "farm-water-dashboard",
      "capacity-timeseries",
      historyAgentIds.join(","),
      capacityFields.join(","),
      before,
      after,
      agentMessageLimit,
    ],
    enabled: historyAgentIds.length > 0 && capacityFields.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const entries = historyAgentIds
        .map((id) => ({ id, path: capacityPathFor(vegaAppKeyByDevice[id] ?? null) }))
        .filter((entry): entry is { id: string; path: string } => !!entry.path);

      const pairs = await Promise.all(
        entries.map(async ({ id, path }) => {
          let response: DataSeriesResponse;
          try {
            response = (await client.messages.getTimeseries(id, "tag_values", {
              before,
              after,
              limit: agentMessageLimit,
              field_name: [path],
            })) as DataSeriesResponse;
          } catch {
            return [id, []] as const;
          }

          const points = (response.results ?? [])
            .map((result) => {
              const value = resolveCapacityNumber(result.value, path);
              const t =
                toEpochMs(result.timestamp) ??
                timestampFromSnowflake(result.message_id) ??
                timestampFromSnowflake(result.id);
              return value == null || t == null ? null : { t, value };
            })
            .filter((point): point is CapacityPoint => point != null)
            .sort((a, b) => a.t - b.t);

          return [id, points] as const;
        }),
      );

      return Object.fromEntries(pairs) as Record<string, CapacityPoint[]>;
    },
  });

  const messageHistoryByDevice = useMemo<Record<string, CapacityPoint[]>>(() => {
    const out: Record<string, CapacityPoint[]> = {};
    for (const message of historyQuery.messages ?? []) {
      const id = message.channel?.agent_id == null ? null : String(message.channel.agent_id);
      if (!id) continue;
      const path = capacityPathFor(vegaAppKeyByDevice[id] ?? null);
      if (!path) continue;
      const value = resolveCapacityNumber(message.data, path);
      const t = toEpochMs(message.timestamp) ?? timestampFromSnowflake(message.id);
      if (value == null || t == null) continue;
      (out[id] ??= []).push({ t, value });
    }
    for (const id of Object.keys(out)) out[id].sort((a, b) => a.t - b.t);
    return out;
  }, [historyQuery.messages, vegaAppKeyByDevice]);

  const historyByDevice = useMemo<Record<string, CapacityPoint[]>>(() => {
    const out: Record<string, CapacityPoint[]> = {};
    const ids = new Set([
      ...Object.keys(messageHistoryByDevice),
      ...Object.keys(timeseriesQuery.data ?? {}),
    ]);
    for (const id of ids) {
      out[id] = mergeHistory(timeseriesQuery.data?.[id] ?? [], messageHistoryByDevice[id] ?? []);
    }
    return out;
  }, [messageHistoryByDevice, timeseriesQuery.data]);

  const rows = useMemo<DeviceRow[]>(() => {
    return devices.map((device, index) => {
      const vegaAppKey = vegaAppKeyByDevice[device.id] ?? null;
      const path = capacityPathFor(vegaAppKey);
      const aggregate = aggregatesByAgent[device.id];
      const current = resolveCapacityNumber(aggregate?.data, path);
      const history = historyByDevice[device.id] ?? [];
      const lastHistoryPoint = history.length ? history[history.length - 1] : null;
      const lastUpdated =
        toEpochMs(aggregate?.last_updated) ?? lastHistoryPoint?.t ?? null;
      return {
        id: device.id,
        name: device.name || device.id,
        displayName: displayNameOf(device),
        deviceTypeName: device.type?.name ?? null,
        chartColor: STACK_COLORS[index % STACK_COLORS.length],
        vegaAppKey,
        capacity: current ?? lastHistoryPoint?.value ?? null,
        lastUpdated,
        history,
        change: latestChange(filterPoints(history, rangeDays)),
      };
    });
  }, [devices, vegaAppKeyByDevice, aggregatesByAgent, historyByDevice, rangeDays]);

  const farmSeries = useMemo(
    () => buildFarmSeries(rows, [], rangeDays),
    [rows, rangeDays],
  );

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const sortedRows = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);
  const onSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const [detailId, setDetailId] = useState<string | null>(null);
  const detailRow = useMemo(
    () => rows.find((row) => row.id === detailId) ?? null,
    [rows, detailId],
  );

  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current || rows.length === 0) return;
    const id = new URLSearchParams(window.location.search).get("device");
    if (id && rows.some((row) => row.id === id)) setDetailId(id);
    deepLinkApplied.current = true;
  }, [rows]);

  const setDeviceParam = (id: string | null) => {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("device", id);
    else url.searchParams.delete("device");
    window.history.replaceState(window.history.state, "", url.toString());
  };
  const openDetail = (row: DeviceRow) => {
    setDetailId(row.id);
    setDeviceParam(row.id);
  };
  const closeDetail = () => {
    setDetailId(null);
    setDeviceParam(null);
  };
  const [fullscreen, setFullscreen] = useState(false);

  if (devicesLoading || (deviceIds.length > 0 && aggregateQuery.isLoading)) {
    return <div className="water-dashboard water-empty">Loading devices...</div>;
  }

  return (
    <div className="water-dashboard">
      <div className="water-header">
        <Summary rows={rows} farmSeries={farmSeries} />
        <div className="water-actions">
          <button
            className="water-button"
            type="button"
            onClick={() => setFullscreen(true)}
            title="Expand"
            aria-label="Open fullscreen dashboard"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      <FarmCapacityChart
        title="Farm Water Capacity"
        rows={rows}
        days={rangeDays}
        onDaysChange={setRangeDays}
        emptyLabel="No capacity history yet. Configure extended permissions for devices running Vega Level Sensor."
      />

      <DeviceTable
        rows={sortedRows}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
        onOpen={openDetail}
      />

      <DeviceQuickView row={detailRow} days={rangeDays} onClose={closeDetail} />

      {fullscreen && (
        <FullscreenDialog
          rows={rows}
          tableRows={sortedRows}
          farmSeries={farmSeries}
          days={rangeDays}
          onDaysChange={setRangeDays}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          onOpen={openDetail}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
}

const WaterCapacityDashboardWidget = (props: any) => (
  <RemoteComponentWrapper>
    <WaterCapacityDashboardWidgetInner {...props} />
  </RemoteComponentWrapper>
);

export default WaterCapacityDashboardWidget;
