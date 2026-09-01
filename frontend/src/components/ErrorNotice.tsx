import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, type } from "@/src/lib/theme";

/**
 * Shown when a fetch fails. Exists so a failure never renders as an empty
 * state — "no orders today" and "we couldn't reach the server" lead to very
 * different decisions.
 */
export function ErrorNotice({
  message,
  onRetry,
  testID,
}: {
  message: string;
  onRetry?: () => void;
  testID?: string;
}) {
  return (
    <View style={s.wrap} testID={testID ?? "error-notice"}>
      <Ionicons name="cloud-offline-outline" size={44} color={colors.onSurfaceTertiary} />
      <Text style={s.title}>Couldn&apos;t load</Text>
      <Text style={s.message}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} style={s.retry} testID="error-retry">
          <Ionicons name="refresh" size={15} color={colors.brandPrimary} />
          <Text style={s.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { alignItems: "center", paddingTop: 60, paddingHorizontal: spacing.xl, gap: spacing.sm },
  title: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  message: { color: colors.onSurfaceTertiary, textAlign: "center" },
  retry: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    marginTop: spacing.md, paddingHorizontal: spacing.xl, height: 40,
    borderRadius: radius.pill, backgroundColor: colors.brandTertiary,
  },
  retryText: { color: colors.brandPrimary, fontWeight: "700" },
});
