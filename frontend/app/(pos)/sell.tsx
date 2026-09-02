import { useMemo, useState } from "react";
import {
  View, Text, StyleSheet, FlatList, Pressable, ScrollView, Modal, TextInput,
  RefreshControl, KeyboardAvoidingView, Platform, useWindowDimensions,
} from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type, formatIDR } from "@/src/lib/theme";
import { useFetch } from "@/src/hooks/use-fetch";
import { ErrorNotice } from "@/src/components/ErrorNotice";
import { SkeletonCardList } from "@/src/components/Skeleton";

type Product = { id: string; name: string; price: number; image_url?: string; on_hand: number };
type StockDay = {
  items: { product_id: string; product_name: string; price: number;
           image_url?: string; on_hand: number }[];
};
type PaymentMethod = "cash" | "qris" | "transfer";

type Sale = {
  id: string;
  receipt_no: string;
  total: number;
  subtotal: number;
  discount: number;
  payment_method: PaymentMethod;
  amount_tendered: number | null;
  change: number | null;
  items: { product_name: string; quantity: number; unit_price: number; subtotal: number }[];
};

const METHODS: { key: PaymentMethod; label: string; icon: any }[] = [
  { key: "cash", label: "Cash", icon: "cash-outline" },
  { key: "qris", label: "QRIS", icon: "qr-code-outline" },
  { key: "transfer", label: "Transfer", icon: "swap-horizontal-outline" },
];

/** Counter staff shouldn't do mental arithmetic — offer the notes they'd actually be handed. */
function cashSuggestions(total: number): number[] {
  const notes = [5000, 10000, 20000, 50000, 100000];
  const out = new Set<number>([Math.ceil(total / 1000) * 1000]);
  for (const n of notes) {
    const rounded = Math.ceil(total / n) * n;
    if (rounded >= total) out.add(rounded);
  }
  return [...out].sort((a, b) => a - b).slice(0, 4);
}

const tap = () => {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

export default function Sell() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Landscape tablet gets a persistent cart beside the grid; phones get a
  // bottom bar that opens the cart, so the grid keeps the full width.
  const isWide = width >= 768;
  const columns = width >= 1024 ? 4 : width >= 768 ? 3 : 2;

  // /stock returns the catalogue *and* what is left of it, so the till needs
  // one call rather than two that could disagree.
  const { data, loading, refreshing, error, refresh, reload } = useFetch<StockDay>(
    "sell-stock",
    () => api<StockDay>("/stock")
  );
  const products = useMemo<Product[]>(
    () => (data?.items ?? []).map((i) => ({
      id: i.product_id, name: i.product_name, price: i.price,
      image_url: i.image_url, on_hand: i.on_hand,
    })),
    [data]
  );

  const [qty, setQty] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [chargeOpen, setChargeOpen] = useState(false);

  const lines = useMemo(
    () => products.filter((p) => (qty[p.id] ?? 0) > 0).map((p) => ({ product: p, n: qty[p.id] })),
    [products, qty]
  );
  const subtotal = lines.reduce((s, l) => s + l.product.price * l.n, 0);
  const count = lines.reduce((s, l) => s + l.n, 0);

  const add = (id: string) => { tap(); setQty((q) => ({ ...q, [id]: (q[id] ?? 0) + 1 })); };
  const sub = (id: string) => setQty((q) => ({ ...q, [id]: Math.max(0, (q[id] ?? 0) - 1) }));
  const clear = () => { setQty({}); setCartOpen(false); };

  const grid = (
    <FlatList
      key={columns}
      testID="sell-grid"
      data={products}
      numColumns={columns}
      keyExtractor={(p) => p.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}
      contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: 140, gap: spacing.md }}
      ListEmptyComponent={
        error ? <ErrorNotice message={error} onRetry={refresh} /> : (
          <View style={s.empty}>
            <Ionicons name="basket-outline" size={44} color={colors.onSurfaceTertiary} />
            <Text style={s.emptyText}>No products available</Text>
          </View>
        )
      }
      renderItem={({ item }) => {
        const n = qty[item.id] ?? 0;
        return (
          <Pressable
            testID={`sell-tile-${item.id}`}
            onPress={() => add(item.id)}
            style={[s.tile, n > 0 && s.tileActive]}
          >
            {item.image_url ? (
              <Image source={item.image_url} style={s.tileImage} contentFit="cover" transition={120} />
            ) : (
              <View style={[s.tileImage, s.tilePlaceholder]}>
                <Ionicons name="cafe-outline" size={26} color={colors.onSurfaceTertiary} />
              </View>
            )}
            <Text style={s.tileName} numberOfLines={1}>{item.name}</Text>
            <Text style={s.tilePrice}>{formatIDR(item.price)}</Text>
            <View style={s.stockRow}>
              <View style={[s.stockDot, item.on_hand <= 0 && { backgroundColor: colors.error }]} />
              <Text style={[s.stockText, item.on_hand <= 0 && { color: colors.error }]}>
                {item.on_hand > 0 ? `${item.on_hand} left` : "Out of stock"}
              </Text>
            </View>
            {n > 0 ? (
              <View style={s.tileBadge}>
                <Text style={s.tileBadgeText}>{n}</Text>
              </View>
            ) : null}
          </Pressable>
        );
      }}
    />
  );

  const cart = (
    <View style={[s.cartPanel, isWide && s.cartPanelWide]}>
      <View style={s.cartHead}>
        <Text style={s.cartTitle}>Cart</Text>
        {count > 0 ? (
          <Pressable onPress={clear} hitSlop={8} testID="clear-cart">
            <Text style={s.clearText}>Clear</Text>
          </Pressable>
        ) : null}
      </View>

      {lines.length === 0 ? (
        <View style={s.cartEmpty}>
          <Ionicons name="cart-outline" size={36} color={colors.onSurfaceTertiary} />
          <Text style={s.cartEmptyText}>Tap a product to start</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
          {lines.map(({ product, n }) => (
            <View key={product.id} style={s.cartLine}>
              <View style={{ flex: 1 }}>
                <Text style={s.cartName} numberOfLines={1}>{product.name}</Text>
                <Text style={s.cartUnit}>{formatIDR(product.price)} each</Text>
              </View>
              <View style={s.stepper}>
                <Pressable onPress={() => sub(product.id)} style={s.stepBtn} testID={`cart-dec-${product.id}`}>
                  <Ionicons name="remove" size={16} color={colors.onSurface} />
                </Pressable>
                <Text style={s.stepQty}>{n}</Text>
                <Pressable onPress={() => add(product.id)} style={s.stepBtn} testID={`cart-inc-${product.id}`}>
                  <Ionicons name="add" size={16} color={colors.onSurface} />
                </Pressable>
              </View>
              <Text style={s.cartSub}>{formatIDR(product.price * n)}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={s.cartFooter}>
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>Total</Text>
          <Text style={s.totalValue} testID="cart-total">{formatIDR(subtotal)}</Text>
        </View>
        <Pressable
          testID="charge-btn"
          disabled={count === 0}
          onPress={() => { setCartOpen(false); setChargeOpen(true); }}
          style={[s.chargeBtn, count === 0 && s.chargeBtnDisabled]}
        >
          <Text style={s.chargeText}>
            {count === 0 ? "Charge" : `Charge ${count} item${count === 1 ? "" : "s"}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Sell</Text>
          <Text style={s.subtitle}>Counter sale</Text>
        </View>
        <Pressable testID="settings-btn" onPress={() => router.push("/settings")} style={s.iconBtn}>
          <Ionicons name="settings-outline" size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {loading ? (
        <SkeletonCardList count={4} />
      ) : isWide ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ flex: 2 }}>{grid}</View>
          {cart}
        </View>
      ) : (
        <>
          {grid}
          <Pressable
            testID="open-cart"
            onPress={() => setCartOpen(true)}
            style={[s.bottomBar, { paddingBottom: insets.bottom || spacing.md }]}
          >
            <View style={s.bottomBadge}>
              <Text style={s.bottomBadgeText}>{count}</Text>
            </View>
            <Text style={s.bottomTotal}>{formatIDR(subtotal)}</Text>
            <Text style={s.bottomCta}>View cart</Text>
          </Pressable>
        </>
      )}

      {/* Phone: cart as a sheet */}
      <Modal visible={cartOpen && !isWide} transparent animationType="slide" onRequestClose={() => setCartOpen(false)}>
        <View style={s.sheetOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCartOpen(false)} />
          <View style={[s.sheet, { paddingBottom: insets.bottom || spacing.lg }]}>{cart}</View>
        </View>
      </Modal>

      <ChargeModal
        visible={chargeOpen && count > 0}
        subtotal={subtotal}
        items={lines.map((l) => ({ product_id: l.product.id, quantity: l.n }))}
        onClose={() => setChargeOpen(false)}
        onDone={() => { setChargeOpen(false); clear(); reload({ refresh: true }); }}
      />
    </View>
  );
}

function ChargeModal({
  visible, subtotal, items, onClose, onDone,
}: {
  visible: boolean;
  subtotal: number;
  items: { product_id: string; quantity: number }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);

  const tenderedNum = Number(tendered.replace(/\D/g, "")) || 0;
  const change = tenderedNum - subtotal;
  const canConfirm =
    items.length > 0 && (method !== "cash" || tenderedNum >= subtotal);

  const reset = () => { setMethod("cash"); setTendered(""); setError(null); setSale(null); };

  const confirm = async () => {
    setError(null); setBusy(true);
    try {
      const created = await api<Sale>("/sales", {
        method: "POST",
        body: JSON.stringify({
          items,
          payment_method: method,
          ...(method === "cash" ? { amount_tendered: tenderedNum } : {}),
        }),
      });
      setSale(created);
    } catch (e: any) {
      setError(e?.message || "Could not complete the sale");
    } finally { setBusy(false); }
  };

  const finish = () => { reset(); onDone(); };

  // react-native-web does not reliably unmount a Modal when `visible` flips to
  // false here, which left the charge sheet on screen after a completed sale.
  // Removing the subtree outright is not dependent on that behaviour.
  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.sheetOverlay}
      >
        {!sale ? <Pressable style={StyleSheet.absoluteFill} onPress={onClose} /> : null}
        <View style={s.chargeCard} testID="charge-modal">
          {sale ? (
            <View testID="sale-receipt">
              <View style={s.doneIcon}>
                <Ionicons name="checkmark" size={30} color={colors.onSuccess} />
              </View>
              <Text style={s.doneTitle}>Sale complete</Text>
              <Text style={s.receiptNo}>Receipt {sale.receipt_no}</Text>

              <View style={s.receiptBox}>
                {sale.items.map((it, i) => (
                  <View key={i} style={s.receiptLine}>
                    <Text style={s.receiptQty}>{it.quantity}×</Text>
                    <Text style={s.receiptName} numberOfLines={1}>{it.product_name}</Text>
                    <Text style={s.receiptAmt}>{formatIDR(it.subtotal)}</Text>
                  </View>
                ))}
                <View style={s.receiptDivider} />
                <View style={s.receiptLine}>
                  <Text style={[s.receiptName, { fontWeight: "800" }]}>Total</Text>
                  <Text style={[s.receiptAmt, { fontWeight: "800" }]}>{formatIDR(sale.total)}</Text>
                </View>
                {sale.change != null ? (
                  <>
                    <View style={s.receiptLine}>
                      <Text style={s.receiptName}>Cash received</Text>
                      <Text style={s.receiptAmt}>{formatIDR(sale.amount_tendered ?? 0)}</Text>
                    </View>
                    <View style={s.changeBox}>
                      <Text style={s.changeLabel}>CHANGE</Text>
                      <Text style={s.changeValue} testID="sale-change">{formatIDR(sale.change)}</Text>
                    </View>
                  </>
                ) : (
                  <Text style={s.paidVia}>Paid via {sale.payment_method.toUpperCase()}</Text>
                )}
              </View>

              <Pressable onPress={finish} style={s.primaryBtn} testID="new-sale-btn">
                <Text style={s.primaryText}>New sale</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={s.chargeTitle}>Charge</Text>
              <Text style={s.chargeAmount}>{formatIDR(subtotal)}</Text>

              <Text style={s.label}>Payment method</Text>
              <View style={s.methodRow}>
                {METHODS.map((m) => {
                  const active = method === m.key;
                  return (
                    <Pressable
                      key={m.key}
                      testID={`method-${m.key}`}
                      onPress={() => setMethod(m.key)}
                      style={[s.methodBtn, active && s.methodBtnActive]}
                    >
                      <Ionicons
                        name={m.icon}
                        size={18}
                        color={active ? colors.brandPrimary : colors.onSurfaceTertiary}
                      />
                      <Text style={[s.methodText, active && { color: colors.brandPrimary }]}>
                        {m.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {method === "cash" ? (
                <>
                  <Text style={s.label}>Cash received</Text>
                  <TextInput
                    testID="tendered-input"
                    style={s.input}
                    value={tendered}
                    onChangeText={(t) => setTendered(t.replace(/\D/g, ""))}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={colors.onSurfaceTertiary}
                  />
                  <View style={s.quickRow}>
                    {cashSuggestions(subtotal).map((v) => (
                      <Pressable
                        key={v}
                        onPress={() => setTendered(String(v))}
                        style={s.quickBtn}
                        testID={`quick-${v}`}
                      >
                        <Text style={s.quickText}>{formatIDR(v)}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {tenderedNum > 0 ? (
                    <View style={s.changePreview}>
                      <Text style={s.changePreviewLabel}>
                        {change >= 0 ? "Change" : "Short by"}
                      </Text>
                      <Text
                        style={[s.changePreviewValue, change < 0 && { color: colors.error }]}
                        testID="change-preview"
                      >
                        {formatIDR(Math.abs(change))}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}

              {error ? <Text style={s.error} testID="charge-error">{error}</Text> : null}

              <View style={s.actions}>
                <Pressable onPress={onClose} style={[s.secondaryBtn]} testID="charge-cancel">
                  <Text style={s.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={confirm}
                  disabled={busy || !canConfirm}
                  style={[s.primaryBtn, { flex: 1, marginTop: 0 }, (!canConfirm || busy) && s.chargeBtnDisabled]}
                  testID="confirm-sale"
                >
                  <Text style={s.primaryText}>{busy ? "Saving…" : "Complete sale"}</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm,
  },
  title: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 2 },
  iconBtn: {
    width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surfaceSecondary,
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border,
  },

  tile: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.md, borderWidth: 2, borderColor: "transparent",
  },
  tileActive: { borderColor: colors.brandPrimary },
  tileImage: { width: "100%", height: 78, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  tilePlaceholder: { alignItems: "center", justifyContent: "center" },
  tileName: { fontWeight: "700", color: colors.onSurface, marginTop: spacing.sm },
  tilePrice: { color: colors.onSurfaceTertiary, fontSize: type.sm, marginTop: 2, fontVariant: ["tabular-nums"] },
  stockRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  stockDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  stockText: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceTertiary },
  tileBadge: {
    position: "absolute", top: 6, right: 6, minWidth: 26, height: 26, borderRadius: 13,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6,
  },
  tileBadgeText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: type.sm },

  cartPanel: { backgroundColor: colors.surfaceSecondary, padding: spacing.lg },
  cartPanelWide: {
    flex: 1, maxWidth: 380, borderLeftWidth: 1, borderLeftColor: colors.border,
  },
  cartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  cartTitle: { fontSize: type.lg, fontWeight: "800", color: colors.onSurface },
  clearText: { color: colors.error, fontWeight: "700", fontSize: type.sm },
  cartEmpty: { alignItems: "center", justifyContent: "center", paddingVertical: spacing["2xl"], gap: spacing.sm },
  cartEmptyText: { color: colors.onSurfaceTertiary },
  cartLine: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  cartName: { fontWeight: "700", color: colors.onSurface },
  cartUnit: { color: colors.onSurfaceTertiary, fontSize: 11 },
  cartSub: { fontWeight: "800", color: colors.onSurface, minWidth: 80, textAlign: "right", fontVariant: ["tabular-nums"] },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stepBtn: {
    width: 30, height: 30, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  stepQty: { minWidth: 22, textAlign: "center", fontWeight: "800", color: colors.onSurface },
  cartFooter: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: spacing.md },
  totalLabel: { color: colors.onSurfaceTertiary, fontWeight: "600" },
  totalValue: { fontSize: type["2xl"], fontWeight: "900", color: colors.onSurface, fontVariant: ["tabular-nums"] },
  chargeBtn: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center",
  },
  chargeBtnDisabled: { opacity: 0.4 },
  chargeText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: type.lg },

  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surfaceInverse, paddingHorizontal: spacing.xl, paddingTop: spacing.md,
  },
  bottomBadge: {
    minWidth: 28, height: 28, borderRadius: 14, backgroundColor: colors.brandSecondary,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  },
  bottomBadgeText: { color: "#fff", fontWeight: "800" },
  bottomTotal: { flex: 1, color: colors.onSurfaceInverse, fontWeight: "800", fontSize: type.lg, fontVariant: ["tabular-nums"] },
  bottomCta: { color: colors.brandTertiary, fontWeight: "700" },

  sheetOverlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "80%" },

  chargeCard: {
    backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: spacing.xl, paddingBottom: spacing["2xl"],
  },
  chargeTitle: { color: colors.onSurfaceTertiary, fontWeight: "700" },
  chargeAmount: { fontSize: 34, fontWeight: "900", color: colors.onSurface, fontVariant: ["tabular-nums"], marginBottom: spacing.md },
  label: { fontSize: type.sm, fontWeight: "600", color: colors.onSurfaceTertiary, marginTop: spacing.md, marginBottom: spacing.xs },
  methodRow: { flexDirection: "row", gap: spacing.sm },
  methodBtn: {
    flex: 1, height: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", gap: 2,
  },
  methodBtnActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  methodText: { fontSize: type.sm, fontWeight: "700", color: colors.onSurfaceTertiary },
  input: {
    height: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, fontSize: type.xl, fontWeight: "800",
    color: colors.onSurface, backgroundColor: colors.surface, fontVariant: ["tabular-nums"],
  },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  quickBtn: {
    paddingHorizontal: spacing.md, height: 36, borderRadius: radius.pill,
    backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center",
  },
  quickText: { color: colors.brandPrimary, fontWeight: "700", fontSize: type.sm },
  changePreview: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary,
  },
  changePreviewLabel: { color: colors.onSurfaceTertiary, fontWeight: "700" },
  changePreviewValue: { fontSize: type.xl, fontWeight: "900", color: colors.success, fontVariant: ["tabular-nums"] },

  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  primaryBtn: {
    height: 52, borderRadius: radius.md, backgroundColor: colors.brandPrimary,
    alignItems: "center", justifyContent: "center", marginTop: spacing.lg,
  },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: type.lg },
  secondaryBtn: {
    height: 52, paddingHorizontal: spacing.xl, borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary, alignItems: "center", justifyContent: "center",
  },
  secondaryText: { color: colors.onSurface, fontWeight: "700" },
  error: { color: colors.error, marginTop: spacing.md },

  doneIcon: {
    alignSelf: "center", width: 56, height: 56, borderRadius: 28, backgroundColor: colors.success,
    alignItems: "center", justifyContent: "center", marginBottom: spacing.md,
  },
  doneTitle: { textAlign: "center", fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  receiptNo: { textAlign: "center", color: colors.onSurfaceTertiary, marginTop: 2, fontVariant: ["tabular-nums"] },
  receiptBox: {
    marginTop: spacing.lg, padding: spacing.lg, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  receiptLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 3 },
  receiptQty: { color: colors.onSurfaceTertiary, fontVariant: ["tabular-nums"], minWidth: 26 },
  receiptName: { flex: 1, color: colors.onSurface },
  receiptAmt: { color: colors.onSurface, fontVariant: ["tabular-nums"] },
  receiptDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  changeBox: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.brandTertiary,
  },
  changeLabel: { color: colors.brandPrimary, fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  changeValue: { color: colors.brandPrimary, fontSize: type["2xl"], fontWeight: "900", fontVariant: ["tabular-nums"] },
  paidVia: { textAlign: "center", color: colors.onSurfaceTertiary, marginTop: spacing.md, fontWeight: "600" },

  empty: { alignItems: "center", paddingTop: 60, gap: spacing.sm },
  emptyText: { color: colors.onSurfaceTertiary },
});
