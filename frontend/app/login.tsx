import { useState } from "react";
import {
  View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator,
} from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/src/lib/auth";
import { colors, spacing, radius, type } from "@/src/lib/theme";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("baker@saltbread.com");
  const [password, setPassword] = useState("baker123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === "login") await signIn(email.trim(), password);
      else await signUp(name.trim(), email.trim(), password);
      router.replace("/(tabs)/dashboard");
    } catch (e: any) {
      setError(e?.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.surface }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.heroWrap}>
        <Image
          source="https://images.unsplash.com/photo-1587241321921-91a834d6d191?w=1200"
          style={StyleSheet.absoluteFill}
          contentFit="cover"
        />
        <LinearGradient
          colors={["rgba(41,37,36,0.15)", "rgba(41,37,36,0.85)"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroContent}>
          <Text style={styles.heroKicker}>SALTBREAD</Text>
          <Text style={styles.heroTitle}>Track your bakery,{"\n"}beautifully.</Text>
        </View>
      </View>

      <ScrollView
        style={styles.formWrap}
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: spacing["3xl"] }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.formTitle}>{mode === "login" ? "Welcome back" : "Create account"}</Text>
        <Text style={styles.formSubtitle}>
          {mode === "login" ? "Sign in to manage orders and revenue" : "Get started with your bakery workspace"}
        </Text>

        {mode === "signup" && (
          <View style={styles.inputBlock}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              testID="signup-name-input"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Baker name"
              placeholderTextColor={colors.onSurfaceTertiary}
            />
          </View>
        )}

        <View style={styles.inputBlock}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            testID="login-email-input"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={colors.onSurfaceTertiary}
          />
        </View>

        <View style={styles.inputBlock}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            testID="login-password-input"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.onSurfaceTertiary}
          />
        </View>

        {error && (
          <Text testID="login-error" style={styles.error}>{error}</Text>
        )}

        <Pressable
          testID="login-submit-button"
          onPress={submit}
          disabled={busy}
          style={({ pressed }) => [styles.submit, pressed && { opacity: 0.85 }]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onBrandPrimary} />
          ) : (
            <Text style={styles.submitText}>{mode === "login" ? "Sign in" : "Create account"}</Text>
          )}
        </Pressable>

        <Pressable
          testID="toggle-auth-mode"
          onPress={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
          style={{ marginTop: spacing.lg, alignItems: "center" }}
        >
          <Text style={styles.toggle}>
            {mode === "login" ? "New here? Create account" : "Already have an account? Sign in"}
          </Text>
        </Pressable>

        {mode === "login" && (
          <Text style={styles.hint}>
            Demo: baker@saltbread.com / baker123
          </Text>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  heroWrap: { height: 240, overflow: "hidden" },
  heroContent: { flex: 1, justifyContent: "flex-end", padding: spacing.xl },
  heroKicker: { color: "#FEF3C7", fontSize: type.sm, letterSpacing: 4, fontWeight: "700", marginBottom: spacing.sm },
  heroTitle: { color: "#fff", fontSize: 28, fontWeight: "800", lineHeight: 34 },
  formWrap: { flex: 1, marginTop: -20, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  formTitle: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface, marginBottom: spacing.xs },
  formSubtitle: { color: colors.onSurfaceTertiary, marginBottom: spacing.xl },
  inputBlock: { marginBottom: spacing.lg },
  label: { fontSize: type.sm, color: colors.onSurfaceTertiary, marginBottom: spacing.xs, fontWeight: "600" },
  input: {
    backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    fontSize: type.lg, color: colors.onSurface,
  },
  submit: {
    backgroundColor: colors.brandPrimary, borderRadius: radius.md, paddingVertical: spacing.lg,
    alignItems: "center", marginTop: spacing.md,
  },
  submitText: { color: colors.onBrandPrimary, fontSize: type.lg, fontWeight: "700" },
  toggle: { color: colors.brand, fontWeight: "600" },
  error: { color: colors.error, marginBottom: spacing.md },
  hint: { textAlign: "center", color: colors.onSurfaceTertiary, marginTop: spacing.xl, fontSize: type.sm },
});
