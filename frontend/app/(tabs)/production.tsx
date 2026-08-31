import { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl, Linking,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type, formatIDR, STATUS_META } from "@/src/lib/theme";
import { SkeletonCardList } from "@/src/components/Skeleton";
import { useFetch } from "@/src/hooks/use-fetch";
import { toISODate, addDays } from "@/src/lib/date";

// --- Types ---

type OrderItem = {
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

type Order = {
  id: string;
  customer_name: string;
  customer_phone?: string;
  delivery_date: string;
  status: keyof typeof STATUS_META;
  total: number;
  notes?: string;
  items: OrderItem[];
};

type ProductionSummary = {
  date: string;
  total_pieces: number;
  order_count: number;
  variants: { product_name: string; quantity: number }[];
  orders: Order[];
};

// --- Helpers ---

function friendlyDate(dateStr: string): string {
  const today = toISODate(new Date());
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  if (dateStr === today) return "Today";
  if (dateStr === tomorrow) return "Tomorrow";
  if (dateStr === yesterday) return "Yesterday";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ID", { weekday: "short", day: "numeric", month: "short" });
}

// --- Inline Status Chip Picker ---

const STATUS_SEQUENCE: (keyof typeof STATUS_META)[] = ["pending", "in_progress", "completed", "cancelled"];

function StatusPicker({
  orderId,
  current,
  onChanged,
}: {
  orderId: string;
  current: keyof typeof STATUS_META;
  onChanged: (updated: Order) => void;
}) {
  const [busy, setBusy] = useState(false);

  const setStatus = async (status: keyof typeof STATUS_META) => {
    if (status === current || busy) return;
    setBusy(true);
    try {
      const updated = await api<Order>(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      onChanged(updated);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={sp.row}>
      {STATUS_SEQUENCE.map((s) => {
        const m = STATUS_META[s];
        const active = current === s;
        return (
          <Pressable
            key={s}
            disabled={busy}
            onPress={() => setStatus(s)}
            style={[sp.btn, active && { backgroundColor: m.bg, borderColor: m.color }]}
          >
            <Text style={[sp.btnText, active && { color: m.color, fontWeight: "800" }]}>
              {m.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const sp = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  btn: {
    paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  btnText: { fontSize: type.sm, color: colors.onSurfaceTertiary, fontWeight: "600" },
});

// --- Main Screen ---

export default function Production() {
  const insets = useSafeAreaInsets();
  const today = toISODate(new Date());
  const [date, setDate] = useState(today);

  const { data, setData, loading, refreshing, error, refresh } =
    useFetch<ProductionSummary>(
      date,
      () => api<ProductionSummary>(`/orders/production-summary?date=${date}`)
    );

  const navigate = (delta: number) => {
    const next = addDays(date, delta);
    setDate(next);
  };

  const handleStatusChange = (updated: Order) => {
    setData((prev) => {
      if (!prev) return prev;
      if (updated.status === "cancelled") {
        const orders = prev.orders.filter((o) => o.id !== updated.id);
        const variantMap: Record<string, number> = {};
        for (const o of orders) {
          for (const item of o.items) {
            variantMap[item.product_name] = (variantMap[item.product_name] || 0) + item.quantity;
          }
        }
        const variants = Object.entries(variantMap)
          .map(([product_name, quantity]) => ({ product_name, quantity }))
          .sort((a, b) => b.quantity - a.quantity);
        const total_pieces = variants.reduce((s, v) => s + v.quantity, 0);
        return { ...prev, orders, variants, total_pieces, order_count: orders.length };
      }
      return {
        ...prev,
        orders: prev.orders.map((o) => (o.id === updated.id ? updated : o)),
      };
    });
  };

  // Window slides with the selection, so the arrows visibly advance the dates.
  // At date === today this still reads "Yesterday | Today | Tomorrow".
  const datePills = [-1, 0, 1].map((offset) => {
    const value = addDays(date, offset);
    return { label: friendlyDate(value), value };
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.title}>Production</Text>
        <Text style={s.subtitle}>Daily baking sheet</Text>
      </View>

      {/* Date Navigator */}
      <View style={s.dateNav}>
        <Pressable onPress={() => navigate(-1)} hitSlop={10} style={s.navArrow}>
          <Ionicons name="chevron-back" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={s.datePillsWrap}>
          {datePills.map((p) => {
            const active = date === p.value;
            return (
              <Pressable
                key={p.value}
                onPress={() => setDate(p.value)}
                style={[s.datePill, active && s.datePillActive]}
              >
                <Text
                  numberOfLines={1}
                  style={[s.datePillText, active && s.datePillTextActive]}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable onPress={() => navigate(1)} hitSlop={10} style={s.navArrow}>
          <Ionicons name="chevron-forward" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={s.dateLabelRow}>
        <Text style={s.dateLabel}>{friendlyDate(date)} — {date}</Text>
        {date !== today ? (
          <Pressable onPress={() => setDate(today)} hitSlop={8} style={s.todayBtn}>
            <Ionicons name="today-outline" size={12} color={colors.brandPrimary} />
            <Text style={s.todayBtnText}>Today</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <SkeletonCardList count={4} />
      ) : (
        <FlatList
          data={data?.orders ?? []}
          keyExtractor={(o) => o.id}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} />
          }
          contentContainerStyle={{ padding: spacing.xl, paddingBottom: 120 }}
          ListHeaderComponent={
            data && data.order_count > 0 ? (
              <View style={s.summaryCard}>
                <View style={s.summaryTop}>
                  <View>
                    <Text style={s.summaryLabel}>TOTAL TO BAKE</Text>
                    <Text style={s.summaryPieces}>{data.total_pieces} pcs</Text>
                    <Text style={s.summaryOrders}>{data.order_count} order{data.order_count !== 1 ? "s" : ""} scheduled</Text>
                  </View>
                  <Ionicons name="restaurant" size={40} color={colors.brandTertiary} style={{ opacity: 0.6 }} />
                </View>
                <View style={s.divider} />
                {data.variants.map((v) => (
                  <View key={v.product_name} style={s.variantRow}>
                    <Text style={s.variantName}>{v.product_name}</Text>
                    <View style={s.variantBadge}>
                      <Text style={s.variantQty}>{v.quantity} pcs</Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons
                name={error ? "cloud-offline-outline" : "cafe-outline"}
                size={52}
                color={colors.onSurfaceTertiary}
              />
              <Text style={s.emptyTitle}>{error ? "Couldn't load" : "Nothing to bake"}</Text>
              <Text style={s.emptySub}>
                {error ? "Pull down to try again" : `No active orders for ${friendlyDate(date)}`}
              </Text>
            </View>
          }
          renderItem={({ item: order }) => {
            const meta = STATUS_META[order.status];
            const itemsSummary = order.items
              .map((i) => `${i.quantity}x ${i.product_name}`)
              .join(", ");
            return (
              <View style={s.card}>
                <View style={s.cardTop}>
                  <Pressable onPress={() => router.push(`/order/${order.id}`)} style={{ flex: 1 }}>
                    <Text style={s.customerName}>{order.customer_name}</Text>
                    {order.customer_phone ? (
                      <Pressable
                        onPress={() => Linking.openURL(`tel:${order.customer_phone}`)}
                        style={s.phoneRow}
                      >
                        <Ionicons name="call-outline" size={13} color={colors.brandPrimary} />
                        <Text style={s.phoneText}>{order.customer_phone}</Text>
                      </Pressable>
                    ) : null}
                  </Pressable>
                  <View style={[s.statusPill, { backgroundColor: meta.bg }]}>
                    <Text style={[s.statusText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                </View>
                <Text style={s.itemsSummary} numberOfLines={2}>{itemsSummary}</Text>
                {order.notes ? (
                  <View style={s.notesRow}>
                    <Ionicons name="document-text-outline" size={13} color={colors.onSurfaceTertiary} />
                    <Text style={s.notesText} numberOfLines={2}>{order.notes}</Text>
                  </View>
                ) : null}
                <View style={s.cardFooter}>
                  <Text style={s.totalText}>{formatIDR(order.total)}</Text>
                </View>
                <StatusPicker
                  orderId={order.id}
                  current={order.status}
                  onChanged={handleStatusChange}
                />
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

// --- Styles ---

const s = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 2 },
  dateNav: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm,
  },
  navArrow: {
    width: 32, height: 32, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center",
  },
  datePillsWrap: { flex: 1, flexDirection: "row", gap: spacing.sm },
  datePill: {
    flex: 1, height: 32, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  datePillActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  datePillText: { fontSize: type.sm, fontWeight: "600", color: colors.onSurfaceTertiary },
  datePillTextActive: { color: colors.onBrandPrimary },
  dateLabelRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.sm, marginBottom: spacing.sm,
  },
  dateLabel: { fontSize: type.sm, color: colors.onSurfaceTertiary },
  todayBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: spacing.md, paddingVertical: 3,
    borderRadius: radius.pill, backgroundColor: colors.brandTertiary,
  },
  todayBtnText: { fontSize: 11, fontWeight: "700", color: colors.brandPrimary },
  summaryCard: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.lg,
    padding: spacing.xl, marginBottom: spacing.lg,
  },
  summaryTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  summaryLabel: { fontSize: 11, fontWeight: "700", color: colors.brandTertiary, textTransform: "uppercase", letterSpacing: 1 },
  summaryPieces: { fontSize: 38, fontWeight: "900", color: colors.onBrandPrimary, fontVariant: ["tabular-nums"] },
  summaryOrders: { fontSize: type.base, color: colors.brandTertiary, marginTop: 2 },
  divider: { height: 1, backgroundColor: "rgba(254,243,199,0.25)", marginVertical: spacing.lg },
  variantRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  variantName: { color: colors.onBrandPrimary, fontWeight: "600", flex: 1 },
  variantBadge: {
    backgroundColor: "rgba(254,243,199,0.2)", paddingHorizontal: spacing.md, paddingVertical: 3, borderRadius: radius.pill,
  },
  variantQty: { color: colors.brandTertiary, fontWeight: "700", fontVariant: ["tabular-nums"] },
  empty: { alignItems: "center", paddingTop: 80, gap: spacing.md },
  emptyTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  emptySub: { color: colors.onSurfaceTertiary, textAlign: "center" },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.sm },
  customerName: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  phoneRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  phoneText: { fontSize: type.sm, color: colors.brandPrimary, fontWeight: "600" },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  statusText: { fontSize: 11, fontWeight: "700" },
  itemsSummary: { color: colors.onSurfaceTertiary, marginBottom: spacing.sm },
  notesRow: { flexDirection: "row", gap: 5, alignItems: "flex-start", marginBottom: spacing.sm },
  notesText: { flex: 1, color: colors.onSurfaceTertiary, fontSize: type.sm, fontStyle: "italic" },
  cardFooter: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.xs },
  totalText: { fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
});
