import { useCallback, useMemo, useState } from "react";
import {
  View, Text, ScrollView, StyleSheet, ActivityIndicator, RefreshControl, Pressable,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { useFocusEffect, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, spacing, radius, type, formatIDR } from "@/src/lib/theme";

type Summary = {
  total_revenue: number;
  total_expenses: number;
  profit: number;
  active_po: number;
  completed_orders: number;
  trend: { date: string; revenue: number; expenses: number }[];
  top_variants: { name: string; quantity: number; revenue: number }[];
  expenses_by_category: { category: string; amount: number }[];
};

type RangeKey = "all" | "week" | "month" | "custom";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function startOfWeek(d: Date) {
  const day = d.getDay(); // 0=Sun
  const diff = (day + 6) % 7; // Mon=0
  const s = new Date(d);
  s.setDate(d.getDate() - diff);
  return s;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function computeRange(key: RangeKey, customFrom: string, customTo: string): { from?: string; to?: string; label: string } {
  const today = new Date();
  if (key === "week") {
    return { from: iso(startOfWeek(today)), to: iso(today), label: "This Week" };
  }
  if (key === "month") {
    return { from: iso(startOfMonth(today)), to: iso(today), label: "This Month" };
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

export default function Dashboard() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [range, setRange] = useState<RangeKey>("all");
  const [customFrom, setCustomFrom] = useState<string>(iso(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState<string>(iso(new Date()));
  const [customModal, setCustomModal] = useState(false);

  const effectiveRange = useMemo(() => computeRange(range, customFrom, customTo), [range, customFrom, customTo]);

  const load = useCallback(async (r = effectiveRange) => {
    try {
      const params = new URLSearchParams();
      if (r.from) params.set("from_date", r.from);
      if (r.to) params.set("to_date", r.to);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const d = await api<Summary>(`/dashboard/summary${suffix}`);
      setData(d);
    } catch {
      // ignore
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }, [effectiveRange]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  if (loading && !data) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }

  return (
    <ScrollView
      testID="dashboard-scroll"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: spacing["3xl"] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.hello}>Hi, {user?.name?.split(" ")[0] || "Baker"}</Text>
          <Text style={styles.subhead}>Here's your bakery snapshot</Text>
        </View>
        <Pressable testID="signout-btn" onPress={signOut} style={styles.iconBtn}>
          <Ionicons name="log-out-outline" size={22} color={colors.onSurface} />
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

      {/* KPI Cards */}
      <View style={styles.kpiGrid}>
        <KpiCard label="Revenue" value={formatIDR(data?.total_revenue || 0)} tone="brand" icon="trending-up" testID="kpi-revenue" />
        <KpiCard label="Expenses" value={formatIDR(data?.total_expenses || 0)} tone="error" icon="trending-down" testID="kpi-expenses" />
        <KpiCard label="Profit" value={formatIDR(data?.profit || 0)} tone="success" icon="cash" testID="kpi-profit" />
        <KpiCard label="Active PO" value={String(data?.active_po || 0)} tone="warning" icon="time" testID="kpi-active-po" />
      </View>

      {/* Trend chart */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Revenue vs Expenses</Text>
        <View style={styles.chartWrap}>
          {data?.trend.map((t) => {
            const rH = (t.revenue / maxTrend) * 120;
            const eH = (t.expenses / maxTrend) * 120;
            const label = t.date.slice(5);
            const showLabel = (data.trend.length <= 8) || (data.trend.indexOf(t) % Math.ceil(data.trend.length / 6) === 0);
            return (
              <View key={t.date} style={styles.barCol}>
                <View style={styles.barStack}>
                  <View style={[styles.bar, { height: Math.max(2, rH), backgroundColor: colors.brandPrimary }]} />
                  <View style={[styles.bar, { height: Math.max(2, eH), backgroundColor: colors.error, marginTop: 4 }]} />
                </View>
                <Text style={styles.barLabel}>{showLabel ? label : ""}</Text>
              </View>
            );
          })}
        </View>
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
        <Pressable testID="quick-new-order" style={styles.quickBtn} onPress={() => router.push("/order/new")}>
          <Ionicons name="add-circle" size={20} color={colors.brandPrimary} />
          <Text style={styles.quickText}>New Order</Text>
        </Pressable>
        <Pressable testID="quick-new-expense" style={styles.quickBtn} onPress={() => router.push("/expense/new")}>
          <Ionicons name="add-circle" size={20} color={colors.brandPrimary} />
          <Text style={styles.quickText}>Log Expense</Text>
        </Pressable>
      </View>

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
            <Text style={styles.label}>From (YYYY-MM-DD)</Text>
            <TextInput
              testID="custom-from"
              style={styles.input}
              value={customFrom}
              onChangeText={setCustomFrom}
              placeholderTextColor={colors.onSurfaceTertiary}
            />
            <Text style={[styles.label, { marginTop: spacing.md }]}>To (YYYY-MM-DD)</Text>
            <TextInput
              testID="custom-to"
              style={styles.input}
              value={customTo}
              onChangeText={setCustomTo}
              placeholderTextColor={colors.onSurfaceTertiary}
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

function KpiCard({ label, value, tone, icon, testID }: any) {
  const bg = { brand: "#FEF3C7", error: "#FFE4E6", success: "#DCFCE7", warning: "#FEF9C3" }[tone as string] as string;
  const fg = { brand: colors.brandPrimary, error: colors.error, success: colors.success, warning: colors.warning }[tone as string] as string;
  return (
    <View testID={testID} style={[styles.kpi, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={18} color={fg} />
      <Text style={[styles.kpiLabel, { color: fg }]}>{label}</Text>
      <Text style={[styles.kpiValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
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
  card: {
    marginHorizontal: spacing.xl, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.lg, marginTop: spacing.md,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, marginBottom: spacing.md },
  chartWrap: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 160 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end" },
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
  quickRow: { flexDirection: "row", paddingHorizontal: spacing.xl, gap: spacing.md, marginTop: spacing.lg },
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
