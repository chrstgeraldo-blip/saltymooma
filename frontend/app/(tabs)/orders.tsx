import { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ScrollView, RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type, formatIDR, STATUS_META } from "@/src/lib/theme";
import { SkeletonCardList } from "@/src/components/Skeleton";
import { useFetch } from "@/src/hooks/use-fetch";
import { useAuth } from "@/src/lib/auth";
import { ErrorNotice } from "@/src/components/ErrorNotice";

type Order = {
  id: string;
  customer_name: string;
  delivery_date: string;
  total: number;
  status: keyof typeof STATUS_META;
  items: { product_name: string; quantity: number }[];
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "in_progress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
];

export default function Orders() {
  const insets = useSafeAreaInsets();
  const { isOwner } = useAuth();
  const [filter, setFilter] = useState("all");

  const { data, loading, refreshing, error, refresh } = useFetch<Order[]>(
    filter,
    () => api<Order[]>(`/orders${filter === "all" ? "" : `?status_filter=${filter}`}`)
  );
  const orders = data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Orders</Text>
          <Text style={styles.subtitle}>{orders.length} {orders.length === 1 ? "order" : "orders"}</Text>
        </View>
        <Pressable testID="till-btn" onPress={() => router.push("/(pos)/sell")} style={styles.iconBtn}>
          <Ionicons name="pricetag-outline" size={20} color={colors.onSurface} />
        </Pressable>
        {/* Admins never see the dashboard, so this is their only way to Settings. */}
        {!isOwner ? (
          <Pressable testID="settings-btn" onPress={() => router.push("/settings")} style={styles.iconBtn}>
            <Ionicons name="settings-outline" size={20} color={colors.onSurface} />
          </Pressable>
        ) : null}
      </View>

      <View style={{ height: 56 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable
                key={f.key}
                testID={`filter-${f.key}`}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <SkeletonCardList count={5} />
      ) : (
        <FlatList
          testID="orders-list"
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.sm, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          ListEmptyComponent={
            error ? (
              <ErrorNotice message={error} onRetry={refresh} />
            ) : (
              <View style={styles.empty}>
                <Ionicons name="basket-outline" size={48} color={colors.onSurfaceTertiary} />
                <Text style={styles.emptyText}>No orders yet</Text>
                <Text style={styles.emptySub}>Tap + to create your first PO</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            const meta = STATUS_META[item.status];
            const itemsSummary = item.items.map((i) => `${i.quantity}x ${i.product_name}`).join(", ");
            return (
              <Pressable
                testID={`order-card-${item.id}`}
                onPress={() => router.push(`/order/${item.id}`)}
                style={styles.card}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.customer}>{item.customer_name}</Text>
                  <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                    <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={styles.itemsText} numberOfLines={2}>{itemsSummary}</Text>
                <View style={styles.cardBottom}>
                  <View style={styles.metaRow}>
                    <Ionicons name="calendar-outline" size={14} color={colors.onSurfaceTertiary} />
                    <Text style={styles.metaText}>{item.delivery_date}</Text>
                  </View>
                  <Text style={styles.totalText}>{formatIDR(item.total)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <Pressable
        testID="new-order-fab"
        onPress={() => router.push("/order/new")}
        style={[styles.fab, { bottom: insets.bottom + 80 }]}
      >
        <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border,
  },
  title: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 2 },
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
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  customer: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface, flex: 1, marginRight: spacing.sm },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: "700" },
  itemsText: { color: colors.onSurfaceTertiary, marginBottom: spacing.md },
  cardBottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.onSurfaceTertiary, fontSize: type.sm },
  totalText: { color: colors.onSurface, fontWeight: "800", fontVariant: ["tabular-nums"] },
  empty: { alignItems: "center", paddingTop: 80, gap: spacing.md },
  emptyText: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  emptySub: { color: colors.onSurfaceTertiary },
  fab: {
    position: "absolute", right: spacing.xl, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
});
