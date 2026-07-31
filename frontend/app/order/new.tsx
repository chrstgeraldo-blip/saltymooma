import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from "react-native";
import { router, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type, formatIDR } from "@/src/lib/theme";

type Product = { id: string; name: string; price: number };

export default function NewOrder() {
  const insets = useSafeAreaInsets();
  const [products, setProducts] = useState<Product[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<Product[]>("/products").then(setProducts).catch(() => {}); }, []);

  const inc = (id: string) => setQty((s) => ({ ...s, [id]: (s[id] || 0) + 1 }));
  const dec = (id: string) => setQty((s) => ({ ...s, [id]: Math.max(0, (s[id] || 0) - 1) }));

  const total = products.reduce((s, p) => s + p.price * (qty[p.id] || 0), 0);
  const hasItems = Object.values(qty).some((v) => v > 0);

  const save = async () => {
    setError(null);
    if (!customerName.trim()) return setError("Customer name is required");
    if (!hasItems) return setError("Please add at least one item");
    setSaving(true);
    try {
      const items = Object.entries(qty)
        .filter(([, q]) => q > 0)
        .map(([product_id, quantity]) => ({ product_id, quantity }));
      await api("/orders", {
        method: "POST",
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim() || undefined,
          delivery_date: deliveryDate,
          items,
          notes: notes.trim() || undefined,
        }),
      });
      router.back();
    } catch (e: any) { setError(e?.message || "Failed to create order"); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="close-new-order" onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New Order</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 200 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.section}>Customer</Text>
        <Field label="Name">
          <TextInput
            testID="order-customer-name" style={styles.input}
            value={customerName} onChangeText={setCustomerName}
            placeholder="e.g. Andi" placeholderTextColor={colors.onSurfaceTertiary}
          />
        </Field>
        <Field label="Phone (optional)">
          <TextInput
            testID="order-customer-phone" style={styles.input}
            value={customerPhone} onChangeText={setCustomerPhone}
            keyboardType="phone-pad" placeholder="08xx..." placeholderTextColor={colors.onSurfaceTertiary}
          />
        </Field>
        <Field label="Delivery date (YYYY-MM-DD)">
          <TextInput
            testID="order-delivery-date" style={styles.input}
            value={deliveryDate} onChangeText={setDeliveryDate}
            placeholder="2026-05-30" placeholderTextColor={colors.onSurfaceTertiary}
          />
        </Field>

        <Text style={[styles.section, { marginTop: spacing.xl }]}>Items</Text>
        {products.map((p) => (
          <View key={p.id} style={styles.itemRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{p.name}</Text>
              <Text style={styles.itemPrice}>{formatIDR(p.price)}</Text>
            </View>
            <View style={styles.stepperRow}>
              <Pressable testID={`dec-${p.id}`} onPress={() => dec(p.id)} style={styles.stepBtn}>
                <Ionicons name="remove" size={18} color={colors.onSurface} />
              </Pressable>
              <Text style={styles.qtyText}>{qty[p.id] || 0}</Text>
              <Pressable testID={`inc-${p.id}`} onPress={() => inc(p.id)} style={styles.stepBtn}>
                <Ionicons name="add" size={18} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
        ))}

        <Text style={[styles.section, { marginTop: spacing.xl }]}>Notes (optional)</Text>
        <TextInput
          testID="order-notes" style={[styles.input, { height: 80, textAlignVertical: "top" }]}
          value={notes} onChangeText={setNotes} multiline
          placeholder="Add note..." placeholderTextColor={colors.onSurfaceTertiary}
        />

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.totalLabel}>Total</Text>
          <Text style={styles.totalValue}>{formatIDR(total)}</Text>
        </View>
        <Pressable
          testID="save-order-btn" onPress={save} disabled={saving}
          style={[styles.submit, saving && { opacity: 0.7 }]}
        >
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create Order</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: any) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: spacing.xl, paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  title: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  section: { fontSize: type.sm, fontWeight: "700", color: colors.onSurfaceTertiary, textTransform: "uppercase", letterSpacing: 1, marginBottom: spacing.sm },
  label: { fontSize: type.sm, color: colors.onSurfaceTertiary, marginBottom: 4, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: type.base, color: colors.onSurface,
  },
  itemRow: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary,
    padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  itemName: { fontWeight: "700", color: colors.onSurface },
  itemPrice: { color: colors.onSurfaceTertiary, marginTop: 2, fontSize: type.sm },
  stepperRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  stepBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surfaceTertiary,
    alignItems: "center", justifyContent: "center",
  },
  qtyText: { minWidth: 22, textAlign: "center", fontWeight: "700", color: colors.onSurface },
  error: { color: colors.error, marginTop: spacing.md },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  totalLabel: { color: colors.onSurfaceTertiary, fontSize: type.sm },
  totalValue: { color: colors.onSurface, fontSize: type.xl, fontWeight: "800", fontVariant: ["tabular-nums"] },
  submit: {
    backgroundColor: colors.brandPrimary, paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.md, minWidth: 140, alignItems: "center",
  },
  submitText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.base },
});
