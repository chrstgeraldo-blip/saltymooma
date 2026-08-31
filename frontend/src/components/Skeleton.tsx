import { useEffect, useRef } from "react";
import { Animated, DimensionValue, StyleSheet, View, ViewStyle } from "react-native";
import { colors, spacing, radius } from "@/src/lib/theme";

/**
 * Pulsing placeholder block. Uses the RN Animated opacity driver (no extra deps),
 * so it runs on the native thread and keeps pulsing during a fetch.
 */
export function Skeleton({
  width = "100%",
  height,
  style,
}: {
  width?: DimensionValue;
  height: number;
  style?: ViewStyle;
}) {
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius.sm, backgroundColor: colors.surfaceTertiary },
        { opacity: pulse },
        style,
      ]}
    />
  );
}

/**
 * Card-shaped rows matching the list layout used by Orders / Expenses /
 * Products / Production, so the page doesn't reflow when real data lands.
 */
export function SkeletonCardList({ count = 4 }: { count?: number }) {
  return (
    <View style={s.listWrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={s.card}>
          <View style={s.cardTop}>
            <Skeleton width="55%" height={16} />
            <Skeleton width={72} height={20} style={{ borderRadius: radius.pill }} />
          </View>
          <Skeleton width="80%" height={12} style={{ marginTop: spacing.md }} />
          <View style={s.cardBottom}>
            <Skeleton width={90} height={12} />
            <Skeleton width={70} height={14} />
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  listWrap: { padding: spacing.xl, paddingTop: spacing.sm },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
  },
});
