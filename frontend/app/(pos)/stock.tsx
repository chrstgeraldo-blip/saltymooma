import { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, Modal, TextInput,
  RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type } from "@/src/lib/theme";
import { useFetch } from "@/src/hooks/use-fetch";
import { ErrorNotice } from "@/src/components/ErrorNotice";
import { SkeletonCardList } from "@/src/components/Skeleton";

type StockRow = {
  product_id: string;
  product_name: string;
  baked: number;
  sold: number;
  wasted: number;
  on_hand: number;
};

type StockDay = {
  date: string;
  items: StockRow[];
  total_baked: number;
  total_sold: number;
  total_on_hand: number;
  total_wasted: number;
};

type Reason = "stock_in" | "waste";

export default function Stock() {
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<{ row: StockRow; reason: Reason } | null>(null);

  const { data, loading, refreshing, error, refresh, reload } = useFetch<StockDay>(
    "stock-today",
    () => api<StockDay>("/stock")
  );
  const items = data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View style={s.header}>
        <Text style={s.title}>Stock</Text>
        <Text style={s.subtitle}>What&apos;s on the shelf today</Text>
      </View>

      {loading ? (
        <SkeletonCardList count={5} />
      ) : error && !data ? (
        <ErrorNotice message={error} onRetry={refresh} />
      ) : (
        <FlatList
          testID="stock-list"
          data={items}
          keyExtractor={(r) => r.product_id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          contentContainerStyle={{ padding: spacing.xl, paddingTop: spacing.sm, paddingBottom: 40 }}
          ListHeaderComponent={
            <View style={s.summary}>
              <View style={s.summaryMain}>
                <Text style={s.summaryLabel}>ON THE SHELF</Text>
                <Text style={s.summaryValue} testID="total-on-hand">{data?.total_on_hand ?? 0}</Text>
                <Text style={s.summarySub}>pieces right now</Text>
              </View>
              <View style={s.summarySide}>
                <View style={s.sideStat}>
                  <Text style={s.sideValue}>{data?.total_baked ?? 0}</Text>
                  <Text style={s.sideLabel}>added</Text>
                </View>
                <View style={s.sideStat}>
                  <Text style={s.sideValue}>{data?.total_sold ?? 0}</Text>
                  <Text style={s.sideLabel}>sold</Text>
                </View>
                <View style={s.sideStat}>
                  <Text style={s.sideValue}>{data?.total_wasted ?? 0}</Text>
                  <Text style={s.sideLabel}>waste</Text>
                </View>
              </View>
            </View>
          }
          renderItem={({ item }) => {
            const out = item.on_hand <= 0;
            return (
              <View style={s.card}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{item.product_name}</Text>
                  <Text style={s.breakdown}>
                    {item.baked} added · {item.sold} sold
                    {item.wasted > 0 ? ` · ${item.wasted} waste` : ""}
                  </Text>
                </View>

                <View style={[s.countBox, out && s.countBoxOut]}>
                  <Text style={[s.count, out && { color: colors.error }]} testID={`on-hand-${item.product_id}`}>
                    {item.on_hand}
                  </Text>
                </View>

                <View style={s.actions}>
                  <Pressable
                    onPress={() => setSheet({ row: item, reason: "stock_in" })}
                    style={[s.actionBtn, s.addBtn]}
                    testID={`add-${item.product_id}`}
                  >
                    <Ionicons name="add" size={18} color={colors.brandPrimary} />
                  </Pressable>
                  <Pressable
                    onPress={() => setSheet({ row: item, reason: "waste" })}
                    style={s.actionBtn}
                    testID={`waste-${item.product_id}`}
                  >
                    <Ionicons name="trash-outline" size={15} color={colors.error} />
                  </Pressable>
                </View>
              </View>
            );
          }}
        />
      )}

      <RecordSheet
        entry={sheet}
        onClose={() => setSheet(null)}
        onSaved={() => { setSheet(null); reload({ refresh: true }); }}
      />
    </View>
  );
}

function RecordSheet({
  entry, onClose, onSaved,
}: {
  entry: { row: StockRow; reason: Reason } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWaste = entry?.reason === "waste";
  const n = Number(qty.replace(/\D/g, "")) || 0;

  const close = () => { setQty(""); setError(null); onClose(); };

  const save = async () => {
    if (!entry || n <= 0) return;
    setError(null); setBusy(true);
    try {
      await api("/stock", {
        method: "POST",
        body: JSON.stringify({
          product_id: entry.row.product_id,
          quantity: n,
          reason: entry.reason,
        }),
      });
      setQty("");
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Could not save");
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={!!entry} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={s.sheet} testID="stock-sheet">
          <Text style={s.sheetTitle}>
            {isWaste ? "Record waste" : "Add stock"}
          </Text>
          <Text style={s.sheetProduct}>{entry?.row.product_name}</Text>

          <TextInput
            testID="stock-qty"
            style={s.input}
            value={qty}
            onChangeText={(t) => setQty(t.replace(/\D/g, ""))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={colors.onSurfaceTertiary}
            autoFocus
          />

          <View style={s.quickRow}>
            {[5, 10, 20, 30].map((v) => (
              <Pressable key={v} onPress={() => setQty(String(v))} style={s.quickBtn} testID={`qty-${v}`}>
                <Text style={s.quickText}>{v}</Text>
              </Pressable>
            ))}
          </View>

          {n > 0 ? (
            <Text style={s.preview}>
              {entry?.row.on_hand} → {isWaste ? (entry?.row.on_hand ?? 0) - n : (entry?.row.on_hand ?? 0) + n} on the shelf
            </Text>
          ) : null}

          {error ? <Text style={s.error} testID="stock-error">{error}</Text> : null}

          <View style={s.sheetActions}>
            <Pressable onPress={close} style={[s.sheetBtn, { backgroundColor: colors.surfaceTertiary }]}>
              <Text style={[s.sheetBtnText, { color: colors.onSurface }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={save}
              disabled={busy || n <= 0}
              style={[
                s.sheetBtn,
                { backgroundColor: isWaste ? colors.error : colors.brandPrimary, flex: 1 },
                (busy || n <= 0) && { opacity: 0.4 },
              ]}
              testID="stock-save"
            >
              <Text style={[s.sheetBtnText, { color: "#fff" }]}>
                {busy ? "Saving…" : isWaste ? "Record waste" : "Add stock"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 2 },
  summary: {
    flexDirection: "row", alignItems: "center", gap: spacing.lg,
    backgroundColor: colors.brandPrimary, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  summaryMain: { flex: 1 },
  summaryLabel: { color: colors.brandTertiary, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  summaryValue: { color: colors.onBrandPrimary, fontSize: 38, fontWeight: "900", fontVariant: ["tabular-nums"] },
  summarySub: { color: colors.brandTertiary, fontSize: type.sm },
  summarySide: { gap: spacing.sm },
  sideStat: { flexDirection: "row", alignItems: "baseline", gap: 6, justifyContent: "flex-end" },
  sideValue: { color: colors.onBrandPrimary, fontWeight: "800", fontVariant: ["tabular-nums"] },
  sideLabel: { color: colors.brandTertiary, fontSize: type.sm, minWidth: 42 },
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  name: { fontWeight: "700", color: colors.onSurface, fontSize: type.lg },
  breakdown: { color: colors.onSurfaceTertiary, fontSize: type.sm, marginTop: 2 },
  countBox: {
    minWidth: 54, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm,
  },
  countBoxOut: { backgroundColor: "#FFE4E6" },
  count: { fontSize: type.xl, fontWeight: "900", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  actions: { gap: spacing.sm },
  actionBtn: {
    width: 38, height: 30, borderRadius: radius.sm, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  addBtn: { backgroundColor: colors.brandTertiary, borderColor: colors.brandTertiary },

  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing["2xl"],
  },
  sheetTitle: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  sheetProduct: { color: colors.onSurfaceTertiary, marginBottom: spacing.lg },
  input: {
    height: 60, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, fontSize: 28, fontWeight: "900",
    color: colors.onSurface, backgroundColor: colors.surface, fontVariant: ["tabular-nums"],
  },
  quickRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  quickBtn: {
    flex: 1, height: 42, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
    alignItems: "center", justifyContent: "center",
  },
  quickText: { color: colors.brandPrimary, fontWeight: "800", fontSize: type.lg },
  preview: { marginTop: spacing.md, color: colors.onSurfaceTertiary, fontWeight: "600" },
  error: { color: colors.error, marginTop: spacing.md },
  sheetActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  sheetBtn: { height: 50, paddingHorizontal: spacing.xl, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  sheetBtnText: { fontWeight: "800" },
});
