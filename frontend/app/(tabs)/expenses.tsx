import { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ScrollView, RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type, formatIDR } from "@/src/lib/theme";
import { SkeletonCardList } from "@/src/components/Skeleton";
import { useFetch } from "@/src/hooks/use-fetch";
import { ErrorNotice } from "@/src/components/ErrorNotice";

type Expense = { id: string; amount: number; category: string; description?: string; date: string };

export default function Expenses() {
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState("all");

  const { data, loading, refreshing, error, refresh, reload } = useFetch(filter, async () => {
    const [ex, cs] = await Promise.all([
      api<Expense[]>(`/expenses${filter === "all" ? "" : `?category=${encodeURIComponent(filter)}`}`),
      api<string[]>("/expenses/categories"),
    ]);
    return { items: ex, cats: cs };
  });
  const items = data?.items ?? [];
  const cats = data?.cats ?? [];

  const total = items.reduce((s, e) => s + e.amount, 0);

  const remove = async (id: string) => {
    await api(`/expenses/${id}`, { method: "DELETE" });
    reload({ refresh: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={styles.title}>Expenses</Text>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{filter === "all" ? "Total" : filter}</Text>
          <Text testID="expenses-total" style={styles.summaryValue}>{formatIDR(total)}</Text>
        </View>
      </View>

      <View style={{ height: 56 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <FilterChip testID="expense-filter-all" active={filter === "all"} label="All" onPress={() => setFilter("all")} />
          {cats.map((c) => (
            <FilterChip
              key={c} testID={`expense-filter-${c}`}
              active={filter === c} label={c} onPress={() => setFilter(c)}
            />
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <SkeletonCardList count={5} />
      ) : (
        <FlatList
          testID="expenses-list"
          data={items}
          keyExtractor={(e) => e.id}
          contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.sm, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListEmptyComponent={
            error ? (
              <ErrorNotice message={error} onRetry={refresh} />
            ) : (
              <View style={styles.empty}>
                <Ionicons name="wallet-outline" size={48} color={colors.onSurfaceTertiary} />
                <Text style={styles.emptyText}>No expenses yet</Text>
                <Text style={styles.emptySub}>Tap + to log your first expense</Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.iconBox}>
                <Ionicons name="pricetag" size={18} color={colors.brandPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.category}</Text>
                {item.description ? <Text style={styles.cardDesc} numberOfLines={1}>{item.description}</Text> : null}
                <Text style={styles.cardDate}>{item.date}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={styles.amount}>{formatIDR(item.amount)}</Text>
                <Pressable
                  testID={`delete-expense-${item.id}`}
                  onPress={() => remove(item.id)}
                  hitSlop={8}
                  style={{ marginTop: 6 }}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      <Pressable
        testID="new-expense-fab"
        onPress={() => router.push("/expense/new")}
        style={[styles.fab, { bottom: insets.bottom + 80 }]}
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

function FilterChip({ label, active, onPress, testID }: any) {
  return (
    <Pressable testID={testID} onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  summaryCard: {
    marginTop: spacing.md, backgroundColor: colors.brandTertiary,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  summaryLabel: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.sm },
  summaryValue: { color: colors.brandPrimary, fontSize: type["2xl"], fontWeight: "800", marginTop: 4, fontVariant: ["tabular-nums"] },
  chipRow: { paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center", paddingVertical: spacing.md },
  chip: {
    height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
    justifyContent: "center", flexShrink: 0,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontWeight: "600", fontSize: type.sm },
  chipTextActive: { color: colors.onBrandPrimary },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, padding: spacing.lg,
    borderRadius: radius.lg, marginBottom: spacing.sm,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  iconBox: {
    width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontWeight: "700", color: colors.onSurface, fontSize: type.base },
  cardDesc: { color: colors.onSurfaceTertiary, marginTop: 2, fontSize: type.sm },
  cardDate: { color: colors.onSurfaceTertiary, marginTop: 2, fontSize: 11 },
  amount: { color: colors.error, fontWeight: "800", fontVariant: ["tabular-nums"] },
  empty: { alignItems: "center", paddingTop: 80, gap: spacing.md },
  emptyText: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  emptySub: { color: colors.onSurfaceTertiary },
  fab: {
    position: "absolute", right: spacing.xl, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
});
