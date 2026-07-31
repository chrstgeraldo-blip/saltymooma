import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from "react-native";
import { router, Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type } from "@/src/lib/theme";

export default function NewExpense() {
  const insets = useSafeAreaInsets();
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<string[]>("/expenses/categories").then((cs) => {
      setCategories(cs);
      if (cs.length) setCategory(cs[0]);
    });
  }, []);

  const save = async () => {
    setError(null);
    const num = parseFloat(amount);
    if (!num || num <= 0) return setError("Enter a valid amount");
    if (!category) return setError("Choose a category");
    setSaving(true);
    try {
      await api("/expenses", {
        method: "POST",
        body: JSON.stringify({ amount: num, category, description: description.trim() || undefined, date }),
      });
      router.back();
    } catch (e: any) { setError(e?.message || "Failed to save"); }
    finally { setSaving(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="close-new-expense" onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>New Expense</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 200 }} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Amount (Rp)</Text>
        <TextInput
          testID="expense-amount" style={styles.amountInput}
          value={amount} onChangeText={setAmount} keyboardType="numeric"
          placeholder="0" placeholderTextColor={colors.onSurfaceTertiary}
        />

        <Text style={[styles.label, { marginTop: spacing.xl }]}>Category</Text>
        <View style={styles.chipRow}>
          {categories.map((c) => {
            const active = category === c;
            return (
              <Pressable
                key={c} testID={`expense-cat-${c}`}
                onPress={() => setCategory(c)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{c}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.label, { marginTop: spacing.xl }]}>Date (YYYY-MM-DD)</Text>
        <TextInput testID="expense-date" style={styles.input} value={date} onChangeText={setDate} />

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Description (optional)</Text>
        <TextInput
          testID="expense-description" style={[styles.input, { height: 80, textAlignVertical: "top" }]}
          value={description} onChangeText={setDescription} multiline
          placeholder="What was this expense for?" placeholderTextColor={colors.onSurfaceTertiary}
        />

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="save-expense-btn" onPress={save} disabled={saving} style={[styles.submit, saving && { opacity: 0.7 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save Expense</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  label: { fontSize: type.sm, color: colors.onSurfaceTertiary, marginBottom: 6, fontWeight: "600" },
  amountInput: {
    backgroundColor: colors.brandTertiary, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
    fontSize: 32, fontWeight: "800", color: colors.brandPrimary, fontVariant: ["tabular-nums"],
  },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: type.base, color: colors.onSurface,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  chipActive: { backgroundColor: colors.brandPrimary, borderColor: colors.brandPrimary },
  chipText: { color: colors.onSurfaceTertiary, fontWeight: "600" },
  chipTextActive: { color: colors.onBrandPrimary },
  error: { color: colors.error, marginTop: spacing.md },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  submit: {
    backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center",
  },
  submitText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.base },
});
