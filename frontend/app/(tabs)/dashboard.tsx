import { useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, Pressable,
  Modal, KeyboardAvoidingView, Platform, useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, spacing, radius, type, formatIDR } from "@/src/lib/theme";
import { Skeleton } from "@/src/components/Skeleton";
import { useFetch } from "@/src/hooks/use-fetch";
import { ErrorNotice } from "@/src/components/ErrorNotice";
import { CalendarGrid } from "@/src/components/CalendarField";
import { toISODate, formatHuman, startOfMonth, startOfWeek } from "@/src/lib/date";

type TrendPoint = {
  date: string;
  end_date: string;
  label: string;
  revenue: number;
  expenses: number;
  order_count: number;
};

type Comparison = {
  from: string;
  to: string;
  total_revenue: number;
  total_expenses: number;
  profit: number;
  revenue_change_pct: number | null;
  expenses_change_pct: number | null;
  profit_change_pct: number | null;
} | null;

type Summary = {
  total_revenue: number;
  total_expenses: number;
  profit: number;
  active_po: number;
  completed_orders: number;
  profit_margin: number | null;
  avg_order_value: number | null;
  comparison: Comparison;
  trend: TrendPoint[];
  granularity: "day" | "week" | "month";
  top_variants: { name: string; quantity: number; revenue: number }[];
  expenses_by_category: { category: string; amount: number }[];
};

type RangeKey = "all" | "week" | "month" | "custom";

function computeRange(key: RangeKey, customFrom: string, customTo: string): { from?: string; to?: string; label: string } {
  const today = new Date();
  if (key === "week") {
    return { from: toISODate(startOfWeek(today)), to: toISODate(today), label: "This Week" };
  }
  if (key === "month") {
    return { from: toISODate(startOfMonth(today)), to: toISODate(today), label: "This Month" };
  }
  if (key === "custom" && customFrom && customTo) {
    return { from: customFrom, to: customTo, label: `${customFrom} → ${customTo}` };
  }
  return { label: "All Time" };
}

const RANGE_TABS: { key: RangeKey; label: string }[] = [
  { key: "all",    label: "All Time" },
  { key: "week",   label: "This Week" },
  { key: "month",  label: "This Month" },
  { key: "custom", label: "Custom" },
];

const CHART_H = 120;
const CHART_MIN_COL = 34;

/** Mirrors the real layout so nothing jumps when data lands. */
function DashboardSkeleton() {
  return (
    <View testID="dashboard-skeleton">
      <View style={styles.kpiGrid}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} width="47%" height={84} style={{ borderRadius: radius.lg }} />
        ))}
      </View>
      <View style={styles.card}>
        <Skeleton width="55%" height={18} />
        <Skeleton height={160} style={{ marginTop: spacing.md }} />
      </View>
      <View style={styles.card}>
        <Skeleton width="45%" height={18} />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={16} style={{ marginTop: spacing.md }} />
        ))}
      </View>
    </View>
  );
}

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const { user } = useAuth();
  const [range, setRange] = useState<RangeKey>("all");
  const [customFrom, setCustomFrom] = useState<string>(toISODate(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState<string>(toISODate(new Date()));
  const [customModal, setCustomModal] = useState(false);
  const [point, setPoint] = useState<TrendPoint | null>(null);
  const [editing, setEditing] = useState<"from" | "to">("from");

  const effectiveRange = useMemo(() => computeRange(range, customFrom, customTo), [range, customFrom, customTo]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (effectiveRange.from) params.set("from_date", effectiveRange.from);
    if (effectiveRange.to) params.set("to_date", effectiveRange.to);
    return params.toString();
  }, [effectiveRange]);

  // Keying on the query string means changing range shows a skeleton, while
  // returning to the tab on the same range refreshes without one.
  const { data, loading, refreshing, error, refresh } = useFetch<Summary>(
    query,
    () => api<Summary>(`/dashboard/summary${query ? `?${query}` : ""}`)
  );

  const pickRange = (key: RangeKey) => {
    if (key === "custom") {
      setCustomModal(true);
      return;
    }
    setRange(key);
  };

  const applyCustom = () => {
    setRange("custom");
    setCustomModal(false);
  };

  const maxTrend = data
    ? Math.max(1, ...data.trend.flatMap((t) => [t.revenue, t.expenses]))
    : 1;

  // Columns keep a minimum width and the chart scrolls once they overflow the
  // card, so a 31-day month reads the same as a 7-day week instead of colliding.
  const chartInnerW = winW - spacing.xl * 2 - spacing.lg * 2;
  const colW = Math.max(CHART_MIN_COL, chartInnerW / Math.max(1, data?.trend.length ?? 1));

  return (
    <ScrollView
      testID="dashboard-scroll"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing["3xl"] }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
        />
      }
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.hello}>Hi, {user?.name?.split(" ")[0] || "Baker"}</Text>
          <Text style={styles.subhead}>Here&apos;s your bakery snapshot</Text>
        </View>
        <Pressable
          testID="settings-btn"
          onPress={() => router.push("/settings")}
          style={styles.iconBtn}
        >
          <Ionicons name="settings-outline" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Range chips */}
      <View style={{ height: 56 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {RANGE_TABS.map((t) => {
            const active = range === t.key;
            return (
              <Pressable
                key={t.key}
                testID={`range-${t.key}`}
                onPress={() => pickRange(t.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{t.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <Text testID="range-label" style={styles.rangeLabel}>Showing: {effectiveRange.label}</Text>
      {data?.comparison && !loading ? (
        <Text style={styles.compareNote}>
          compared with {formatHuman(data.comparison.from)} – {formatHuman(data.comparison.to)}
        </Text>
      ) : null}

      {loading ? <DashboardSkeleton /> : error && !data ? (
        <ErrorNotice message={error} onRetry={refresh} />
      ) : (
        <>
      {/* KPI Cards */}
      <View style={styles.kpiGrid}>
        <KpiCard
          label="Revenue" value={formatIDR(data?.total_revenue || 0)}
          tone="brand" icon="trending-up" testID="kpi-revenue"
          delta={data?.comparison?.revenue_change_pct ?? undefined}
        />
        <KpiCard
          label="Expenses" value={formatIDR(data?.total_expenses || 0)}
          tone="error" icon="trending-down" testID="kpi-expenses"
          delta={data?.comparison?.expenses_change_pct ?? undefined} invert
        />
        <KpiCard
          label="Profit" value={formatIDR(data?.profit || 0)}
          tone="success" icon="cash" testID="kpi-profit"
          delta={data?.comparison?.profit_change_pct ?? undefined}
        />
        <KpiCard
          label="Active PO" value={String(data?.active_po || 0)}
          tone="warning" icon="time" testID="kpi-active-po"
          note="open now, all dates"
        />
      </View>

      {/* Rates */}
      <View style={styles.card}>
        <View style={styles.rateRow}>
          <View style={styles.rateItem} testID="stat-margin">
            <Text style={styles.rateLabel}>Profit margin</Text>
            <Text style={styles.rateValue}>
              {data?.profit_margin != null ? `${data.profit_margin}%` : "—"}
            </Text>
          </View>
          <View style={styles.rateDivider} />
          <View style={styles.rateItem} testID="stat-aov">
            <Text style={styles.rateLabel}>Avg order value</Text>
            <Text style={styles.rateValue}>
              {data?.avg_order_value != null ? formatIDR(data.avg_order_value) : "—"}
            </Text>
          </View>
        </View>
      </View>

      {/* Trend chart */}
      <View style={styles.card}>
        <View style={styles.chartHead}>
          <Text style={[styles.cardTitle, { marginBottom: 0 }]}>Revenue vs Expenses</Text>
          <Text style={styles.chartPeak}>peak {formatIDR(maxTrend)}</Text>
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ minWidth: chartInnerW }}
        >
          <View style={styles.chartWrap}>
            {data?.trend.map((t) => {
              const rH = (t.revenue / maxTrend) * CHART_H;
              const eH = (t.expenses / maxTrend) * CHART_H;
              return (
                <Pressable
                  key={t.date}
                  testID={`bar-${t.date}`}
                  onPress={() => setPoint(t)}
                  style={[styles.barCol, { width: colW }]}
                >
                  <View style={styles.barStack}>
                    <View style={[styles.bar, { height: Math.max(2, rH), backgroundColor: colors.brandPrimary }]} />
                    <View style={[styles.bar, { height: Math.max(2, eH), backgroundColor: colors.error }]} />
                  </View>
                  <Text style={styles.barLabel} numberOfLines={1}>{t.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.brandPrimary }]} />
            <Text style={styles.legendText}>Revenue</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colors.error }]} />
            <Text style={styles.legendText}>Expenses</Text>
          </View>
        </View>
      </View>

      {/* Top variants */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top-selling variants</Text>
        {(!data?.top_variants || data.top_variants.length === 0) ? (
          <Text style={styles.emptyText}>No completed orders in this range</Text>
        ) : (
          data.top_variants.map((v, i) => (
            <View key={v.name} style={styles.rowItem}>
              <View style={styles.rankBadge}><Text style={styles.rankText}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{v.name}</Text>
                <Text style={styles.rowSub}>{v.quantity} sold</Text>
              </View>
              <Text style={styles.rowRight}>{formatIDR(v.revenue)}</Text>
            </View>
          ))
        )}
      </View>

      {/* Expense breakdown */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Expenses by category</Text>
        {(!data?.expenses_by_category || data.expenses_by_category.length === 0) ? (
          <Text style={styles.emptyText}>No expenses in this range</Text>
        ) : (
          data.expenses_by_category.map((c) => {
            const pct = (data.total_expenses || 0) > 0 ? (c.amount / data.total_expenses) * 100 : 0;
            return (
              <View key={c.category} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text style={styles.rowTitle}>{c.category}</Text>
                  <Text style={styles.rowRight}>{formatIDR(c.amount)}</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${pct}%` }]} />
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Quick actions */}
      <View style={styles.quickRow}>
        <Pressable testID="quick-sell" style={styles.quickBtn} onPress={() => router.push("/(pos)/sell")}>
          <Ionicons name="pricetag" size={20} color={colors.brandPrimary} />
          <Text style={styles.quickText}>New Sale</Text>
        </Pressable>
        <Pressable testID="quick-new-order" style={styles.quickBtn} onPress={() => router.push("/order/new")}>
          <Ionicons name="add-circle" size={20} color={colors.brandPrimary} />
          <Text style={styles.quickText}>New Order</Text>
        </Pressable>
        <Pressable testID="quick-new-expense" style={styles.quickBtn} onPress={() => router.push("/expense/new")}>
          <Ionicons name="add-circle" size={20} color={colors.brandPrimary} />
          <Text style={styles.quickText}>Log Expense</Text>
        </Pressable>
      </View>
        </>
      )}

      {/* Tapped-bar detail */}
      <Modal
        visible={!!point}
        transparent
        animationType="fade"
        onRequestClose={() => setPoint(null)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPoint(null)} />
          <View style={styles.modalCard} testID="bar-detail-modal">
            <Text style={styles.modalTitle}>
              {point ? (point.date === point.end_date
                ? formatHuman(point.date)
                : `${formatHuman(point.date)} – ${formatHuman(point.end_date)}`) : ""}
            </Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Revenue</Text>
              <Text style={styles.detailValue}>{formatIDR(point?.revenue || 0)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Expenses</Text>
              <Text style={styles.detailValue}>{formatIDR(point?.expenses || 0)}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Profit</Text>
              <Text style={[styles.detailValue, {
                color: (point?.revenue || 0) - (point?.expenses || 0) >= 0 ? colors.success : colors.error,
              }]}>
                {formatIDR((point?.revenue || 0) - (point?.expenses || 0))}
              </Text>
            </View>
            <View style={[styles.detailRow, { borderBottomWidth: 0 }]}>
              <Text style={styles.detailLabel}>Orders completed</Text>
              <Text style={styles.detailValue}>{point?.order_count ?? 0}</Text>
            </View>
            <Pressable
              testID="bar-detail-close"
              onPress={() => setPoint(null)}
              style={[styles.modalBtn, { backgroundColor: colors.brandPrimary, marginTop: spacing.md }]}
            >
              <Text style={[styles.modalBtnText, { color: colors.onBrandPrimary }]}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Custom range modal */}
      <Modal
        visible={customModal}
        transparent
        animationType="fade"
        onRequestClose={() => setCustomModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalOverlay}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCustomModal(false)} />
          <View style={styles.modalCard} testID="custom-range-modal">
            <Text style={styles.modalTitle}>Custom range</Text>
            <View style={styles.edgeRow}>
              {(["from", "to"] as const).map((edge) => {
                const active = editing === edge;
                const val = edge === "from" ? customFrom : customTo;
                return (
                  <Pressable
                    key={edge}
                    testID={`custom-${edge}`}
                    onPress={() => setEditing(edge)}
                    style={[styles.edgeBtn, active && styles.edgeBtnActive]}
                  >
                    <Text style={[styles.edgeLabel, active && { color: colors.brandPrimary }]}>
                      {edge === "from" ? "From" : "To"}
                    </Text>
                    <Text style={[styles.edgeValue, active && { color: colors.brandPrimary }]}>
                      {formatHuman(val)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <CalendarGrid
              value={editing === "from" ? customFrom : customTo}
              onChange={(iso) => {
                if (editing === "from") { setCustomFrom(iso); setEditing("to"); }
                else { setCustomTo(iso); }
              }}
            />
            <View style={styles.modalActions}>
              <Pressable
                testID="custom-cancel"
                onPress={() => setCustomModal(false)}
                style={[styles.modalBtn, { backgroundColor: colors.surfaceTertiary }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.onSurface }]}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="custom-apply"
                onPress={applyCustom}
                style={[styles.modalBtn, { backgroundColor: colors.brandPrimary }]}
              >
                <Text style={[styles.modalBtnText, { color: colors.onBrandPrimary }]}>Apply</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

function KpiCard({ label, value, tone, icon, testID, delta, note, invert }: any) {
  const bg = { brand: "#FEF3C7", error: "#FFE4E6", success: "#DCFCE7", warning: "#FEF9C3" }[tone as string] as string;
  const fg = { brand: colors.brandPrimary, error: colors.error, success: colors.success, warning: colors.warning }[tone as string] as string;
  // `invert` flips the good/bad reading: rising expenses is not a win.
  const rising = typeof delta === "number" && delta > 0;
  const good = invert ? !rising : rising;
  return (
    <View testID={testID} style={[styles.kpi, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={[styles.kpiLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {typeof delta === "number" ? (
        <View style={styles.deltaRow}>
          <Ionicons
            name={rising ? "arrow-up" : "arrow-down"}
            size={11}
            color={good ? colors.success : colors.error}
          />
          <Text style={[styles.deltaText, { color: good ? colors.success : colors.error }]}>
            {Math.abs(delta)}%
          </Text>
        </View>
      ) : note ? (
        <Text style={[styles.kpiNote, { color: fg }]}>{note}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.xl, marginBottom: spacing.md,
  },
  hello: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  subhead: { color: colors.onSurfaceTertiary, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border,
  },
  chipRow: { paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.md },
  chip: {
    height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    justifyContent: "center", flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontWeight: "600", fontSize: type.sm },
  chipTextActive: { color: colors.onBrandPrimary },
  rangeLabel: {
    paddingHorizontal: spacing.xl, color: colors.onSurfaceTertiary, fontSize: type.sm,
    marginBottom: spacing.sm,
  },
  kpiGrid: {
    flexDirection: "row", flexWrap: "wrap", gap: spacing.md,
    paddingHorizontal: spacing.xl, marginBottom: spacing.md,
  },
  kpi: {
    width: "47%", padding: spacing.lg, borderRadius: radius.lg,
  },
  kpiLabel: { fontSize: type.sm, fontWeight: "600", marginTop: spacing.xs },
  kpiValue: { fontSize: type.lg, fontWeight: "800", marginTop: spacing.xs, fontVariant: ["tabular-nums"] },
  kpiNote: { fontSize: 10, marginTop: 3, opacity: 0.75 },
  deltaRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 3 },
  deltaText: { fontSize: 11, fontWeight: "800", fontVariant: ["tabular-nums"] },
  compareNote: {
    paddingHorizontal: spacing.xl, marginTop: -spacing.sm, marginBottom: spacing.md,
    fontSize: type.sm, color: colors.onSurfaceTertiary,
  },
  edgeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  edgeBtn: {
    flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
  },
  edgeBtnActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  edgeLabel: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceTertiary },
  edgeValue: { fontSize: type.base, fontWeight: "700", color: colors.onSurface, marginTop: 2 },
  rateRow: { flexDirection: "row", alignItems: "center" },
  rateItem: { flex: 1, alignItems: "center" },
  rateDivider: { width: 1, height: 34, backgroundColor: colors.divider },
  rateLabel: { fontSize: type.sm, color: colors.onSurfaceTertiary, fontWeight: "600" },
  rateValue: {
    fontSize: type.xl, fontWeight: "800", color: colors.onSurface,
    marginTop: 2, fontVariant: ["tabular-nums"],
  },
  detailRow: {
    flexDirection: "row", justifyContent: "space-between",
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  detailLabel: { color: colors.onSurfaceTertiary },
  detailValue: { fontWeight: "700", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  card: {
    marginHorizontal: spacing.xl, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  chartHead: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "baseline", marginBottom: spacing.md,
  },
  chartPeak: { fontSize: type.sm, color: colors.onSurfaceTertiary, fontVariant: ["tabular-nums"] },
  chartWrap: { flexDirection: "row", alignItems: "flex-end", height: 160 },
  barCol: { alignItems: "center", justifyContent: "flex-end", flexShrink: 0 },
  barStack: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 130 },
  bar: { width: 6, borderRadius: 3 },
  barLabel: { fontSize: 10, color: colors.onSurfaceTertiary, marginTop: 4 },
  legendRow: { flexDirection: "row", justifyContent: "center", gap: spacing.xl, marginTop: spacing.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: type.sm, color: colors.onSurfaceTertiary },
  emptyText: { color: colors.onSurfaceTertiary, textAlign: "center", paddingVertical: spacing.md },
  rowItem: {
    flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md,
  },
  rankBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  rankText: { color: colors.brandPrimary, fontWeight: "800" },
  rowTitle: { color: colors.onSurface, fontWeight: "600" },
  rowSub: { color: colors.onSurfaceTertiary, fontSize: type.sm, marginTop: 2 },
  rowRight: { color: colors.onSurface, fontWeight: "700", fontVariant: ["tabular-nums"] },
  progressTrack: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.brandSecondary },
  quickRow: {
    flexWrap: "wrap", flexDirection: "row", paddingHorizontal: spacing.xl, gap: spacing.md, marginTop: spacing.lg },
  quickBtn: {
    flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center",
    padding: spacing.lg, backgroundColor: colors.brandTertiary, borderRadius: radius.md,
  },
  quickText: { color: colors.brandPrimary, fontWeight: "700" },
  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center", justifyContent: "center", padding: spacing.xl,
  },
  modalCard: {
    width: "100%", maxWidth: 400, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.xl,
  },
  modalTitle: {
    fontSize: type.lg, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md,
  },
  label: { fontSize: type.sm, color: colors.onSurfaceTertiary, marginBottom: 6, fontWeight: "600" },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: type.base, color: colors.onSurface,
  },
  modalActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  modalBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  modalBtnText: { fontWeight: "700" },
});
