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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDown,
  ArrowUp,
  Download,
  ExternalLink,
  Maximize2,
  X,
} from "lucide-react";

dayjs.extend(localizedFormat);
dayjs.extend(relativeTime);

const DAY_MS = 86_400_000;
const DEFAULT_HISTORY_DAYS = 7;
const MAX_HISTORY_DAYS = 90;
const FLEET_MSG_CEILING = 50_000;
const DEFAULT_AGENT_MSG_LIMIT = 500;
const VEGA_APP_NAME = "vega_level_sensor";
const VEGA_CAPACITY_TAG = "last_volume";
const VEGA_FULL_CAPACITY_TAG = "full_volume";
const LEGACY_UI_VOLUME_PATH = "state.children.vegameterlastVolume";
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
  { label: "90d", days: 90 },
];

type ScaleMode = "capacity" | "fit";
const SCALE_OPTIONS: { label: string; mode: ScaleMode; title: string }[] = [
  { label: "Capacity", mode: "capacity", title: "Scale the axis to total storage capacity" },
  { label: "Fit", mode: "fit", title: "Zoom the axis to the stored water level" },
];
const DEFAULT_SCALE_MODE: ScaleMode = "capacity";

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

interface UiStateData {
  state?: {
    children?: Record<string, unknown> | null;
  } | null;
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

interface PrimitiveLeaf {
  path: string;
  value: string | number | boolean | null;
}

interface LegacyMarker {
  path: string;
  value: string;
}

interface LegacyUiCapacity {
  value: number | null;
  fullCapacity: number | null;
  path: string | null;
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
  legacyMarkerValue: string | null;
  capacity: number | null;
  fullCapacity: number | null;
  lastUpdated: number | null;
  history: CapacityPoint[];
  change: number | null;
}

type SortKey = "name" | "capacity" | "fullCapacity" | "change" | "lastUpdated";
type SortDir = "asc" | "desc";

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function numFromDisplay(value: unknown): number | null {
  const direct = num(value);
  if (direct != null) return direct;
  if (typeof value !== "string" || value.includes("$")) return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  return num(match[0]);
}

function toEpochMs(value: unknown): number | null {
  const n = num(value);
  if (n == null || n <= 0) return null;
  return n < 100_000_000_000 ? n * 1000 : n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
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

function fullCapacityPathFor(appKey: string | null): string | null {
  return appKey ? `${appKey}.${VEGA_FULL_CAPACITY_TAG}` : null;
}

function maxRangeBound(element: unknown): number | null {
  const ranges = (element as { ranges?: unknown } | null)?.ranges;
  if (!Array.isArray(ranges)) return null;
  let max: number | null = null;
  for (const range of ranges) {
    const record = range as { max?: unknown; to?: unknown; upper?: unknown; value?: unknown } | null;
    const bound = num(record?.max) ?? num(record?.to) ?? num(record?.upper) ?? num(record?.value);
    if (bound != null && (max == null || bound > max)) max = bound;
  }
  return max;
}

function primitiveLeaves(value: unknown, path = ""): PrimitiveLeaf[] {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [{ path, value: value as PrimitiveLeaf["value"] }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => primitiveLeaves(item, path ? `${path}.${index}` : String(index)));
  }
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    primitiveLeaves(item, path ? `${path}.${key}` : key),
  );
}

function legacyMarkerFromTagData(data: unknown): LegacyMarker | null {
  if (isRecord(data)) {
    const entries = Object.entries(data).filter(([, value]) => value != null);
    if (entries.length === 1) {
      const [key] = entries[0];
      if (key.toLowerCase().includes("legacy")) return { path: key, value: key };
    }
  }

  const leaves = primitiveLeaves(data).filter((leaf) => leaf.value != null);
  if (leaves.length !== 1) return null;
  const [leaf] = leaves;
  if (typeof leaf.value !== "string" || !leaf.value.toLowerCase().includes("legacy")) return null;
  return { path: leaf.path, value: leaf.value };
}

function elementText(element: Record<string, unknown>, path: string): string {
  const parts = [
    path,
    element.name,
    element.displayString,
    element.display_name,
    element.label,
    element.units,
  ];
  const ranges = element.ranges;
  if (Array.isArray(ranges)) {
    for (const range of ranges) {
      if (isRecord(range)) parts.push(range.label, range.name);
    }
  }
  return parts
    .filter((part): part is string => typeof part === "string")
    .join(" ")
    .toLowerCase();
}

function numericElementValue(element: Record<string, unknown>): number | null {
  for (const key of [
    "currentValue",
    "current_value",
    "value",
    "displayValue",
    "display_value",
    "lastValue",
    "last_value",
    "rawValue",
    "raw_value",
  ]) {
    const value = numFromDisplay(element[key]);
    if (value != null) return value;
  }
  return null;
}

function legacyCapacityFromUiState(uiState: unknown): LegacyUiCapacity {
  const candidates: Array<LegacyUiCapacity & { score: number }> = [];

  const legacyVolume = resolveDottedValue(uiState, LEGACY_UI_VOLUME_PATH);
  if (isRecord(legacyVolume)) {
    const fullCapacity = maxRangeBound(legacyVolume);
    const value = numericElementValue(legacyVolume);
    if (fullCapacity != null || value != null) {
      return {
        value,
        fullCapacity,
        path: LEGACY_UI_VOLUME_PATH,
      };
    }
  }

  const visit = (node: unknown, path: string) => {
    if (!isRecord(node)) return;

    const fullCapacity = maxRangeBound(node);
    if (fullCapacity != null && fullCapacity > 0) {
      const text = elementText(node, path);
      const units = typeof node.units === "string" ? node.units.toLowerCase() : "";
      const hasCapacityName = /\b(volume|capacity|storage)\b/.test(text);
      const hasWaterName = /\b(water|tank|dam|level)\b/.test(text);
      const hasCapacityUnits = /\b(ml|megs?|mega\s*litres?|megalitres?|litres?|l|m3|m\^3)\b/.test(units);
      const isPercent = units === "%" || units.includes("percent");
      const isClearlySensor =
        /\b(reliability|distance|sensor|battery|signal|rssi|db)\b/.test(text) ||
        units === "db";

      if (!isClearlySensor || hasCapacityName || hasCapacityUnits) {
        const value = numericElementValue(node);
        let score = 0;
        if (hasCapacityName) score += 100;
        if (hasCapacityUnits) score += 70;
        if (hasWaterName) score += 30;
        if (value != null) score += 20;
        if (text.includes("full")) score += 10;
        if (isPercent) score -= 50;
        if (isClearlySensor) score -= 100;
        if (score > 0 || value != null) {
          candidates.push({ value, fullCapacity, path, score });
        }
      }
    }

    const children = node.children;
    if (isRecord(children)) {
      for (const [key, child] of Object.entries(children)) {
        visit(child, path ? `${path}.children.${key}` : `children.${key}`);
      }
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === "children" || key === "ranges") continue;
      if (isRecord(child)) visit(child, path ? `${path}.${key}` : key);
    }
  };

  visit(uiState, "");
  candidates.sort((a, b) => b.score - a.score || (b.fullCapacity ?? 0) - (a.fullCapacity ?? 0));
  const best = candidates[0];
  return best
    ? { value: best.value, fullCapacity: best.fullCapacity, path: best.path || null }
    : { value: null, fullCapacity: null, path: null };
}

// Derive a reservoir's full volume from the device's published UI state: the
// Vega "volume" gauge sets its top range bound to the full storage volume.
// Lets the dashboard show capacity for already-deployed devices that don't yet
// publish the full_volume tag.
function fullVolumeFromUiState(
  uiState: UiStateData | undefined,
  appKey: string | null,
): number | null {
  if (!appKey) return null;
  const app = uiState?.state?.children?.[appKey] as
    | { children?: Record<string, unknown> | null }
    | undefined;
  const children = app?.children;
  if (!children || typeof children !== "object") return null;

  const preferred = maxRangeBound(children.volume);
  if (preferred != null) return preferred;

  for (const element of Object.values(children)) {
    const bound = maxRangeBound(element);
    if (bound != null) return bound;
  }
  return null;
}

function tagNameFromPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.split(".");
  return parts[parts.length - 1] ?? null;
}

function resolveDottedValue(source: unknown, path: string | null | undefined): unknown {
  if (!path || source == null || typeof source !== "object") return null;
  let current: unknown = source;
  for (const part of path.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function resolveDottedNumber(source: unknown, path: string | null | undefined): number | null {
  return num(resolveDottedValue(source, path));
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

function legacyCapacityValueFromUiState(uiState: unknown, path: string | null): number | null {
  if (!path) return legacyCapacityFromUiState(uiState).value;
  const currentValue = numFromDisplay(resolveDottedValue(uiState, `${path}.currentValue`));
  if (currentValue != null) return currentValue;

  const element = resolveDottedValue(uiState, path);
  return isRecord(element) ? numericElementValue(element) : null;
}

function legacyBridgeTimestamp(uiStateMessageData: unknown): number | null {
  return toEpochMs(
    isRecord(uiStateMessageData)
      ? uiStateMessageData.doover_legacy_bridge_at
      : null,
  );
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
  return `${Math.round(value)} ML`;
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

function percentFull(value: number | null, full: number | null): number | null {
  if (full == null || full <= 0 || value == null) return null;
  return Math.round((chartCapacity(value) / full) * 100);
}

// Export the current storages and their levels over the selected window to a
// multi-sheet .xlsx. xlsx is loaded on demand so it stays out of the initial
// bundle.
async function exportStoragesToExcel(rows: DeviceRow[], days: number): Promise<void> {
  const XLSX = await import("xlsx");

  const roundOrNull = (value: number | null): number | null =>
    value == null ? null : Math.round(value);

  const wb = XLSX.utils.book_new();

  const summaryHeader = [
    "Storage",
    "Current Level (ML)",
    "Full Capacity (ML)",
    "Percent Full (%)",
    `Change over ${days}d (ML)`,
    "Last Updated",
  ];
  const summaryRows = rows.map((row) => [
    row.displayName,
    roundOrNull(row.capacity),
    roundOrNull(row.fullCapacity),
    percentFull(row.capacity, row.fullCapacity),
    roundOrNull(row.change),
    row.lastUpdated ? dayjs(row.lastUpdated).format("YYYY-MM-DD HH:mm") : null,
  ]);
  const summary = XLSX.utils.aoa_to_sheet([summaryHeader, ...summaryRows]);
  summary["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 20 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, summary, "Summary");

  const { data, series } = buildStackedFarmData(rows, days);
  const levelsHeader = ["Time", ...series.map((s) => `${s.name} (ML)`)];
  const levelsRows = data.map((point) => [
    dayjs(num(point.t) ?? 0).format("YYYY-MM-DD HH:mm"),
    ...series.map((s) => roundOrNull(num(point[s.key]))),
  ]);
  const levels = XLSX.utils.aoa_to_sheet([levelsHeader, ...levelsRows]);
  levels["!cols"] = [{ wch: 18 }, ...series.map(() => ({ wch: 16 }))];
  XLSX.utils.book_append_sheet(wb, levels, "Levels Over Time");

  XLSX.writeFile(wb, `stored-water-${days}d-${dayjs().format("YYYYMMDD-HHmm")}.xlsx`);
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
  scaleMode,
  onScaleModeChange,
  emptyLabel,
}: {
  title: string;
  rows: DeviceRow[];
  days: number;
  onDaysChange: (days: number) => void;
  scaleMode: ScaleMode;
  onScaleModeChange: (mode: ScaleMode) => void;
  emptyLabel: string;
}) {
  const { data, series } = useMemo(() => buildStackedFarmData(rows, days), [rows, days]);

  const totalFullCapacity = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + (row.fullCapacity ?? 0), 0);
    return total > 0 ? total : null;
  }, [rows]);

  const maxStacked = useMemo(() => {
    let max = 0;
    for (const point of data) {
      let stacked = 0;
      for (const item of series) stacked += num(point[item.key]) ?? 0;
      if (stacked > max) max = stacked;
    }
    return max;
  }, [data, series]);

  // "capacity" scales the axis to total storage capacity (the dotted line sits
  // near the top); "fit" zooms to the stored-water level for detail.
  const yMax = useMemo(() => {
    const ceiling =
      scaleMode === "capacity" ? Math.max(maxStacked, totalFullCapacity ?? 0) : maxStacked;
    return ceiling > 0 ? Math.ceil(ceiling * 1.05) : "auto";
  }, [scaleMode, maxStacked, totalFullCapacity]);

  return (
    <div className="water-panel">
      <div className="water-panel-header">
        <span className="water-panel-title">{title}</span>
        <div className="water-panel-controls">
          {totalFullCapacity != null && (
            <div className="water-range-group" aria-label="Axis scaling">
              {SCALE_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  className="water-range-button"
                  type="button"
                  title={option.title}
                  onClick={() => onScaleModeChange(option.mode)}
                  aria-pressed={scaleMode === option.mode}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
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
                domain={[0, yMax]}
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
              {totalFullCapacity != null && (
                <ReferenceLine
                  y={totalFullCapacity}
                  stroke="var(--muted-foreground)"
                  strokeDasharray="6 4"
                  strokeWidth={1.5}
                  ifOverflow={scaleMode === "capacity" ? "extendDomain" : "hidden"}
                  label={{
                    value: `Total capacity ${fmtCapacity(totalFullCapacity)}`,
                    position: "insideTopRight",
                    fill: "var(--muted-foreground)",
                    fontSize: 11,
                  }}
                />
              )}
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
  const hasConfiguredDevice = rows.some((r) => r.vegaAppKey || r.legacyMarkerValue);
  const shownTotal = latestFarm ?? (hasConfiguredDevice ? currentTotal : null);

  return (
    <div className="water-summary">
      <span className="water-chip">
        Storages <strong>{rows.length}</strong>
      </span>
      <span className="water-chip">
        Stored water <strong>{fmtCapacity(shownTotal)}</strong>
      </span>
    </div>
  );
}

function FillBar({
  value,
  full,
  color,
}: {
  value: number | null;
  full: number | null;
  color: string;
}) {
  if (full == null || full <= 0 || value == null) {
    return <span className="water-muted">Capacity unknown</span>;
  }
  const pct = Math.max(0, Math.min(100, (chartCapacity(value) / full) * 100));
  return (
    <span
      className="water-fillbar"
      title={`${pct.toFixed(0)}% full (${fmtCapacity(value)} of ${fmtCapacity(full)})`}
    >
      <span className="water-fillbar-track">
        <span
          className="water-fillbar-fill"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </span>
      <span className="water-fillbar-label">{pct.toFixed(0)}%</span>
    </span>
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
              <SortHeader label="Level / Capacity" sortKey="capacity" current={sortKey} dir={sortDir} onSort={onSort} />
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
                        <FillBar value={row.capacity} full={row.fullCapacity} color={row.chartColor} />
                      </span>
                    </span>
                  </td>
                  <td className="water-level-cell">
                    {fmtCapacity(row.capacity)}
                    {row.fullCapacity != null && (
                      <span className="water-capacity-secondary"> / {fmtCapacity(row.fullCapacity)}</span>
                    )}
                  </td>
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
            <span>Level</span>
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
  scaleMode,
  onScaleModeChange,
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
  scaleMode: ScaleMode;
  onScaleModeChange: (mode: ScaleMode) => void;
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
            Stored Water
          </h2>
          <div className="water-muted">Fleet storage overview</div>
        </div>
        <div className="water-actions">
          <button
            className="water-button"
            type="button"
            onClick={() => {
              void exportStoragesToExcel(rows, days).catch((error) => {
                console.error("Failed to export storages to Excel", error);
              });
            }}
            disabled={rows.length === 0}
            title="Export to Excel"
            aria-label="Export storages to Excel"
          >
            <Download size={14} />
          </button>
          <button className="water-dialog-close" type="button" onClick={onClose} aria-label="Close fullscreen">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="water-fullscreen-content">
        <Summary rows={rows} farmSeries={farmSeries} />
        <FarmCapacityChart
          title="Stored Water"
          rows={rows}
          days={days}
          onDaysChange={onDaysChange}
          scaleMode={scaleMode}
          onScaleModeChange={onScaleModeChange}
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

  const [scaleMode, setScaleMode] = useState<ScaleMode>(DEFAULT_SCALE_MODE);

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

  const { aggregatesByAgent: allTagAggregatesByAgent, query: allTagAggregateQuery } =
    useMultiAgentAggregates<TagAggregate>(
      "tag_values",
      deviceIds,
      { liveUpdates: false },
    );

  const legacyMarkerByDevice = useMemo<Record<string, LegacyMarker>>(() => {
    const out: Record<string, LegacyMarker> = {};
    for (const device of devices) {
      const marker = legacyMarkerFromTagData(allTagAggregatesByAgent[device.id]?.data);
      if (marker) out[device.id] = marker;
    }
    return out;
  }, [devices, allTagAggregatesByAgent]);

  const { aggregatesByAgent, query: aggregateQuery } = useMultiAgentAggregates<TagAggregate>(
    "tag_values",
    deviceIds,
    { fields: fieldRoots },
  );

  // Published UI schema per device — used to read each reservoir's full volume
  // from the Vega volume gauge's range bounds.
  const { aggregatesByAgent: uiStateByAgent } = useMultiAgentAggregates<UiStateData>(
    "ui_state",
    deviceIds,
    { fields: ["state", "doover_legacy_bridge_at"] },
  );

  const legacyUiCapacityByDevice = useMemo<Record<string, LegacyUiCapacity>>(() => {
    const out: Record<string, LegacyUiCapacity> = {};
    for (const device of devices) {
      if (!legacyMarkerByDevice[device.id]) continue;
      out[device.id] = legacyCapacityFromUiState(uiStateByAgent[device.id]?.data);
    }
    return out;
  }, [devices, legacyMarkerByDevice, uiStateByAgent]);

  const fleetTop = useMemo(() => Date.now() + 60_000, []);
  const before = useMemo(() => generateSnowflakeIdAtTime(fleetTop), [fleetTop]);
  const after = useMemo(
    () => generateSnowflakeIdAtTime(fleetTop - MAX_HISTORY_DAYS * DAY_MS),
    [fleetTop],
  );
  const normalHistoryAgentIds = useMemo(
    () => devices.filter((d) => vegaAppKeyByDevice[d.id]).map((d) => d.id),
    [devices, vegaAppKeyByDevice],
  );
  const legacyHistoryAgentIds = useMemo(
    () => devices.filter((d) => legacyMarkerByDevice[d.id]).map((d) => d.id),
    [devices, legacyMarkerByDevice],
  );
  const historyAgentCount = normalHistoryAgentIds.length + legacyHistoryAgentIds.length;
  const agentMessageLimit = useMemo(
    () =>
      historyAgentCount > 0
        ? Math.max(1, Math.min(DEFAULT_AGENT_MSG_LIMIT, Math.floor(FLEET_MSG_CEILING / historyAgentCount)))
        : DEFAULT_AGENT_MSG_LIMIT,
    [historyAgentCount],
  );
  const historyQuery = useMultiAgentChannelMessages<ChannelMessage>(
    "tag_values",
    normalHistoryAgentIds,
    {
      initialBefore: before,
      after,
      agentMessageLimit,
      fields: fieldRoots,
      liveUpdates: false,
    },
  );

  const legacyUiHistoryQuery = useMultiAgentChannelMessages<ChannelMessage>(
    "ui_state",
    legacyHistoryAgentIds,
    {
      initialBefore: before,
      agentMessageLimit,
      fields: ["state", "doover_legacy_bridge_at"],
      liveUpdates: false,
    },
  );

  const timeseriesQuery = useQuery({
    queryKey: [
      "farm-water-dashboard",
      "capacity-timeseries",
      normalHistoryAgentIds.join(","),
      capacityFields.join(","),
      before,
      after,
      agentMessageLimit,
    ],
    enabled: normalHistoryAgentIds.length > 0 && capacityFields.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const entries = normalHistoryAgentIds
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

  const legacyMessageHistoryByDevice = useMemo<Record<string, CapacityPoint[]>>(() => {
    const out: Record<string, CapacityPoint[]> = {};
    for (const message of legacyUiHistoryQuery.messages ?? []) {
      const id = message.channel?.agent_id == null ? null : String(message.channel.agent_id);
      if (!id || !legacyMarkerByDevice[id]) continue;
      const value = legacyCapacityValueFromUiState(
        message.data,
        legacyUiCapacityByDevice[id]?.path ?? LEGACY_UI_VOLUME_PATH,
      );
      const t =
        legacyBridgeTimestamp(message.data) ??
        toEpochMs(message.timestamp) ??
        timestampFromSnowflake(message.id);
      if (value == null || t == null) continue;
      (out[id] ??= []).push({ t, value });
    }
    for (const id of Object.keys(out)) out[id].sort((a, b) => a.t - b.t);
    return out;
  }, [legacyUiHistoryQuery.messages, legacyMarkerByDevice, legacyUiCapacityByDevice]);

  const historyByDevice = useMemo<Record<string, CapacityPoint[]>>(() => {
    const out: Record<string, CapacityPoint[]> = {};
    const ids = new Set([
      ...Object.keys(messageHistoryByDevice),
      ...Object.keys(legacyMessageHistoryByDevice),
      ...Object.keys(timeseriesQuery.data ?? {}),
    ]);
    for (const id of ids) {
      const normalHistory = mergeHistory(timeseriesQuery.data?.[id] ?? [], messageHistoryByDevice[id] ?? []);
      out[id] = mergeHistory(normalHistory, legacyMessageHistoryByDevice[id] ?? []);
    }
    return out;
  }, [messageHistoryByDevice, legacyMessageHistoryByDevice, timeseriesQuery.data]);

  const rows = useMemo<DeviceRow[]>(() => {
    return devices.map((device, index) => {
      const vegaAppKey = vegaAppKeyByDevice[device.id] ?? null;
      const legacyMarker = legacyMarkerByDevice[device.id] ?? null;
      const legacyUiCapacity = legacyUiCapacityByDevice[device.id];
      const path = capacityPathFor(vegaAppKey);
      const aggregate = aggregatesByAgent[device.id];
      const uiStateAggregate = uiStateByAgent[device.id];
      const current =
        resolveCapacityNumber(aggregate?.data, path) ??
        (legacyMarker ? legacyUiCapacity?.value ?? null : null);
      const fullCapacity =
        resolveCapacityNumber(aggregate?.data, fullCapacityPathFor(vegaAppKey)) ??
        fullVolumeFromUiState(uiStateAggregate?.data, vegaAppKey) ??
        (legacyMarker ? legacyUiCapacity?.fullCapacity ?? null : null);
      const history = historyByDevice[device.id] ?? [];
      const lastHistoryPoint = history.length ? history[history.length - 1] : null;
      const lastUpdated =
        toEpochMs(aggregate?.last_updated) ??
        (legacyMarker
          ? legacyBridgeTimestamp(uiStateAggregate?.data) ?? toEpochMs(uiStateAggregate?.last_updated)
          : null) ??
        lastHistoryPoint?.t ??
        null;
      // Current level is a stored volume, so floor it at zero (a reading below
      // empty is meaningless); keep null distinct so "unknown" still shows "-".
      const rawCapacity = current ?? lastHistoryPoint?.value ?? null;
      return {
        id: device.id,
        name: device.name || device.id,
        displayName: displayNameOf(device),
        deviceTypeName: device.type?.name ?? null,
        chartColor: STACK_COLORS[index % STACK_COLORS.length],
        vegaAppKey,
        legacyMarkerValue: legacyMarker?.value ?? null,
        capacity: rawCapacity == null ? null : Math.max(0, rawCapacity),
        fullCapacity,
        lastUpdated,
        history,
        change: latestChange(filterPoints(history, rangeDays)),
      };
    });
  }, [
    devices,
    vegaAppKeyByDevice,
    legacyMarkerByDevice,
    legacyUiCapacityByDevice,
    aggregatesByAgent,
    uiStateByAgent,
    historyByDevice,
    rangeDays,
  ]);

  const farmSeries = useMemo(
    () => buildFarmSeries(rows, [], rangeDays),
    [rows, rangeDays],
  );

  const [sortKey, setSortKey] = useState<SortKey>("fullCapacity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
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

  const handleExport = () => {
    void exportStoragesToExcel(rows, rangeDays).catch((error) => {
      console.error("Failed to export storages to Excel", error);
    });
  };

  if (
    devicesLoading ||
    (deviceIds.length > 0 && (aggregateQuery.isLoading || allTagAggregateQuery.isLoading))
  ) {
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
            onClick={handleExport}
            disabled={rows.length === 0}
            title="Export to Excel"
            aria-label="Export storages to Excel"
          >
            <Download size={14} />
          </button>
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
        title="Stored Water"
        rows={rows}
        days={rangeDays}
        onDaysChange={setRangeDays}
        scaleMode={scaleMode}
        onScaleModeChange={setScaleMode}
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
          scaleMode={scaleMode}
          onScaleModeChange={setScaleMode}
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
