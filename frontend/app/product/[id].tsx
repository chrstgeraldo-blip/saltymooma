import { useEffect, useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Switch,
} from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type } from "@/src/lib/theme";

export default function ProductEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const isNew = id === "new";

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [active, setActive] = useState(true);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    api<any[]>("/products").then((list) => {
      const p = list.find((x) => x.id === id);
      if (p) {
        setName(p.name); setPrice(String(p.price)); setImageUrl(p.image_url || ""); setActive(p.active);
      }
    }).finally(() => setLoading(false));
  }, [id, isNew]);

  const save = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    const num = parseFloat(price);
    if (!num || num <= 0) return setError("Enter a valid price");
    setSaving(true);
    try {
      if (isNew) {
        await api("/products", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), price: num, image_url: imageUrl.trim() || undefined }),
        });
      } else {
        await api(`/products/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), price: num, image_url: imageUrl.trim() || null, active }),
        });
      }
      router.back();
    } catch (e: any) { setError(e?.message || "Save failed"); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    await api(`/products/${id}`, { method: "DELETE" });
    router.back();
  };

  if (loading) return <View style={styles.centered}><ActivityIndicator color={colors.brandPrimary} /></View>;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="close-product" onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="close" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{isNew ? "New Product" : "Edit Product"}</Text>
        {!isNew ? (
          <Pressable testID="delete-product-btn" onPress={remove} hitSlop={8}>
            <Ionicons name="trash-outline" size={22} color={colors.error} />
          </Pressable>
        ) : <View style={{ width: 22 }} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 160 }} keyboardShouldPersistTaps="handled">
        {imageUrl ? (
          <View style={styles.previewWrap}>
            <Image source={imageUrl} style={StyleSheet.absoluteFill} contentFit="cover" />
          </View>
        ) : null}

        <Text style={styles.label}>Name</Text>
        <TextInput testID="product-name" style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Cream Cheese" placeholderTextColor={colors.onSurfaceTertiary} />

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Price (Rp)</Text>
        <TextInput testID="product-price" style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="20000" placeholderTextColor={colors.onSurfaceTertiary} />

        <Text style={[styles.label, { marginTop: spacing.lg }]}>Image URL (optional)</Text>
        <TextInput testID="product-image" style={styles.input} value={imageUrl} onChangeText={setImageUrl} autoCapitalize="none" placeholder="https://..." placeholderTextColor={colors.onSurfaceTertiary} />

        {!isNew && (
          <View style={styles.switchRow}>
            <Text style={styles.label}>Active</Text>
            <Switch value={active} onValueChange={setActive} testID="product-active-switch" />
          </View>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="save-product-btn" onPress={save} disabled={saving} style={[styles.submit, saving && { opacity: 0.7 }]}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>{isNew ? "Create Product" : "Save Changes"}</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
  title: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  previewWrap: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceTertiary, marginBottom: spacing.lg },
  label: { fontSize: type.sm, color: colors.onSurfaceTertiary, marginBottom: 6, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    fontSize: type.base, color: colors.onSurface,
  },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg },
  error: { color: colors.error, marginTop: spacing.md },
  footer: {
    position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
  },
  submit: { backgroundColor: colors.brandPrimary, paddingVertical: spacing.lg, borderRadius: radius.md, alignItems: "center" },
  submitText: { color: colors.onBrandPrimary, fontWeight: "700", fontSize: type.base },
});
