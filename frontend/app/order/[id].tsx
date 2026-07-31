import { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useFocusEffect, router, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type, formatIDR, STATUS_META } from "@/src/lib/theme";

type Order = {
  id: string; customer_name: string; customer_phone?: string;
  delivery_date: string; status: keyof typeof STATUS_META; total: number;
  items: { product_name: string; quantity: number; unit_price: number; subtotal: number }[];
  notes?: string; created_at: string;
};

const STATUS_ORDER: (keyof typeof STATUS_META)[] = ["pending", "in_progress", "completed", "cancelled"];

export default function OrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      const o = await api<Order>(`/orders/${id}`);
      setOrder(o);
    } finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const setStatus = async (status: string) => {
    setUpdating(true);
    try {
      const o = await api<Order>(`/orders/${id}/status`, {
        method: "PATCH", body: JSON.stringify({ status }),
      });
      setOrder(o);
    } finally { setUpdating(false); }
  };

  const remove = async () => {
    await api(`/orders/${id}`, { method: "DELETE" });
    router.back();
  };

  if (loading || !order) {
    return (
      <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>
    );
  }

  const meta = STATUS_META[order.status];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="back-btn" onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Order</Text>
        <Pressable testID="delete-order-btn" onPress={remove} hitSlop={8}>
          <Ionicons name="trash-outline" size={22} color={colors.error} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 200 }}>
        <View style={[styles.statusPill, { backgroundColor: meta.bg, alignSelf: "flex-start" }]}>
          <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
        </View>

        <Text style={styles.customer}>{order.customer_name}</Text>
        {order.customer_phone ? <Text style={styles.meta}>{order.customer_phone}</Text> : null}

        <View style={styles.metaRow}>
          <Ionicons name="calendar-outline" size={16} color={colors.onSurfaceTertiary} />
          <Text style={styles.meta}>Deliver on {order.delivery_date}</Text>
        </View>

        <Text style={styles.section}>Items</Text>
        <View style={styles.card}>
          {order.items.map((it, i) => (
            <View key={i} style={styles.itemRow}>
              <Text style={styles.itemName}>{it.quantity}x {it.product_name}</Text>
              <Text style={styles.itemPrice}>{formatIDR(it.subtotal)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.itemRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatIDR(order.total)}</Text>
          </View>
        </View>

        {order.notes ? (
          <>
            <Text style={styles.section}>Notes</Text>
            <View style={styles.card}><Text style={styles.notes}>{order.notes}</Text></View>
          </>
        ) : null}

        <Text style={styles.section}>Update status</Text>
        <View style={styles.statusGrid}>
          {STATUS_ORDER.map((s) => {
            const m = STATUS_META[s];
            const active = order.status === s;
            return (
              <Pressable
                key={s}
                testID={`status-${s}`}
                disabled={updating}
                onPress={() => setStatus(s)}
                style={[styles.statusBtn, active && { backgroundColor: m.bg, borderColor: m.color }]}
              >
                <Text style={[styles.statusBtnText, active && { color: m.color, fontWeight: "800" }]}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  headerTitle: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, marginBottom: spacing.md },
  statusText: { fontWeight: "700", fontSize: type.sm },
  customer: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  meta: { color: colors.onSurfaceTertiary, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  section: { fontSize: type.sm, fontWeight: "700", color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.xl, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg,
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  itemRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm },
  itemName: { color: colors.onSurface, fontWeight: "600", flex: 1 },
  itemPrice: { color: colors.onSurface, fontVariant: ["tabular-nums"] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  totalLabel: { fontWeight: "800", color: colors.onSurface },
  totalValue: { fontWeight: "800", color: colors.brandPrimary, fontSize: type.lg, fontVariant: ["tabular-nums"] },
  notes: { color: colors.onSurface },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  statusBtn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  statusBtnText: { color: colors.onSurface, fontWeight: "600" },
});
