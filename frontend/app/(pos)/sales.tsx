import { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { useAuth } from "@/src/lib/auth";
import { colors, spacing, radius, type, formatIDR } from "@/src/lib/theme";
import { useFetch } from "@/src/hooks/use-fetch";
import { ErrorNotice } from "@/src/components/ErrorNotice";
import { SkeletonCardList } from "@/src/components/Skeleton";
import { toISODate, addDays, formatHuman } from "@/src/lib/date";

type Sale = {
  id: string;
  receipt_no: string;
  total: number;
  payment_method: "cash" | "qris" | "transfer";
  change: number | null;
  cashier_id: string;
  cashier_name: string;
  voided: boolean;
  created_at: string;
  items: { product_name: string; quantity: number }[];
};

const METHOD_LABEL = { cash: "Cash", qris: "QRIS", transfer: "Transfer" };

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString("en-ID", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function Sales() {
  const insets = useSafeAreaInsets();
  const { user, isOwner } = useAuth();
  const [day, setDay] = useState(toISODate(new Date()));
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Voided sales stay visible: a financial correction must be auditable.
  const { data, loading, refreshing, error, refresh, reload } = useFetch<Sale[]>(
    day,
    () => api<Sale[]>(`/sales?date_str=${day}&include_voided=true`)
  );
  const sales = data ?? [];
  const takings = sales.filter((s) => !s.voided).reduce((sum, s) => sum + s.total, 0);
  const liveCount = sales.filter((s) => !s.voided).length;

  const voidSale = async (id: string) => {
    setConfirmId(null);
    await api(`/sales/${id}/void`, { method: "POST" });
    reload({ refresh: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="sales-back">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title}>Sales</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={s.dateNav}>
        <Pressable onPress={() => setDay(addDays(day, -1))} hitSlop={10} style={s.navArrow}>
          <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={s.dateLabel}>{formatHuman(day)}</Text>
        <Pressable
          onPress={() => setDay(addDays(day, 1))}
          hitSlop={10}
          style={[s.navArrow, day >= toISODate(new Date()) && { opacity: 0.3 }]}
          disabled={day >= toISODate(new Date())}
        >
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={s.summary}>
        <Text style={s.summaryLabel}>TAKINGS</Text>
        <Text style={s.summaryValue} testID="takings-total">{formatIDR(takings)}</Text>
        <Text style={s.summarySub}>
          {liveCount} sale{liveCount === 1 ? "" : "s"}
          {sales.length > liveCount ? ` · ${sales.length - liveCount} voided` : ""}
        </Text>
      </View>

      {loading ? (
        <SkeletonCardList count={4} />
      ) : (
        <FlatList
          testID="sales-list"
          data={sales}
          keyExtractor={(x) => x.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.sm, paddingBottom: 60 }}
          ListEmptyComponent={
            error ? <ErrorNotice message={error} onRetry={refresh} /> : (
              <View style={s.empty}>
                <Ionicons name="receipt-outline" size={44} color={colors.onSurfaceTertiary} />
                <Text style={s.emptyText}>No sales on this day</Text>
              </View>
            )
          }
          renderItem={({ item }) => {
            // Cashiers may correct their own mistakes; owners may correct anything.
            const canVoid = !item.voided && (isOwner || item.cashier_id === user?.id);
            return (
              <View style={[s.card, item.voided && s.cardVoided]}>
                <View style={s.cardTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.receipt, item.voided && s.struck]}>{item.receipt_no}</Text>
                    <Text style={s.meta}>
                      {clockTime(item.created_at)} · {METHOD_LABEL[item.payment_method]} · {item.cashier_name}
                    </Text>
                  </View>
                  <Text style={[s.total, item.voided && s.struck]}>{formatIDR(item.total)}</Text>
                </View>

                <Text style={s.items} numberOfLines={2}>
                  {item.items.map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}
                </Text>

                {item.voided ? (
                  <View style={s.voidTag}>
                    <Ionicons name="close-circle" size={13} color={colors.error} />
                    <Text style={s.voidTagText}>Voided</Text>
                  </View>
                ) : confirmId === item.id ? (
                  <View style={s.confirmRow}>
                    <Pressable onPress={() => setConfirmId(null)} style={s.confirmCancel}>
                      <Text style={s.confirmCancelText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => voidSale(item.id)}
                      style={s.confirmVoid}
                      testID={`confirm-void-${item.receipt_no}`}
                    >
                      <Text style={s.confirmVoidText}>Void sale</Text>
                    </Pressable>
                  </View>
                ) : canVoid ? (
                  <Pressable
                    onPress={() => setConfirmId(item.id)}
                    style={s.voidBtn}
                    testID={`void-${item.receipt_no}`}
                  >
                    <Ionicons name="close-circle-outline" size={14} color={colors.error} />
                    <Text style={s.voidBtnText}>Void</Text>
                  </Pressable>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  title: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  dateNav: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.lg, paddingBottom: spacing.sm,
  },
  navArrow: {
    width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary,
  },
  dateLabel: { fontWeight: "700", color: colors.onSurface, minWidth: 140, textAlign: "center" },
  summary: {
    marginHorizontal: spacing.xl, marginBottom: spacing.sm, padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.brandPrimary,
  },
  summaryLabel: { color: colors.brandTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  summaryValue: {
    color: colors.onBrandPrimary, fontSize: 30, fontWeight: "900", fontVariant: ["tabular-nums"],
  },
  summarySub: { color: colors.brandTertiary, fontSize: type.sm, marginTop: 2 },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  cardVoided: { opacity: 0.6 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  receipt: { fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  meta: { color: colors.onSurfaceTertiary, fontSize: type.sm, marginTop: 2 },
  total: { fontWeight: "800", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  struck: { textDecorationLine: "line-through" },
  items: { color: colors.onSurfaceTertiary, marginTop: spacing.sm },
  voidBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start",
    marginTop: spacing.sm, paddingHorizontal: spacing.md, height: 30,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
  },
  voidBtnText: { color: colors.error, fontWeight: "700", fontSize: type.sm },
  confirmRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  confirmCancel: { paddingHorizontal: spacing.md, height: 32, justifyContent: "center" },
  confirmCancelText: { color: colors.onSurfaceTertiary, fontWeight: "600", fontSize: type.sm },
  confirmVoid: {
    paddingHorizontal: spacing.lg, height: 32, borderRadius: radius.pill,
    backgroundColor: colors.error, justifyContent: "center",
  },
  confirmVoidText: { color: colors.onError, fontWeight: "700", fontSize: type.sm },
  voidTag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  voidTagText: { color: colors.error, fontWeight: "700", fontSize: type.sm },
  empty: { alignItems: "center", paddingTop: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
