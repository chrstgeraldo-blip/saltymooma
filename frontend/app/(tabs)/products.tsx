import {
  View, Text, StyleSheet, FlatList, Pressable, RefreshControl,
} from "react-native";
import { router } from "expo-router";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { colors, spacing, radius, type, formatIDR } from "@/src/lib/theme";
import { SkeletonCardList } from "@/src/components/Skeleton";
import { useFetch } from "@/src/hooks/use-fetch";
import { useAuth } from "@/src/lib/auth";
import { ErrorNotice } from "@/src/components/ErrorNotice";

type Product = { id: string; name: string; price: number; image_url?: string; active: boolean };

export default function Products() {
  const insets = useSafeAreaInsets();
  // Admins need prices to take an order, but editing the catalogue is the
  // owner's — the API rejects their writes either way.
  const { isOwner } = useAuth();
  const { data, loading, refreshing, error, refresh } = useFetch<Product[]>(
    "products",
    () => api<Product[]>("/products?include_inactive=true")
  );
  const items = data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View style={styles.header}>
        <Text style={styles.title}>Products</Text>
        <Text style={styles.subtitle}>Manage saltbread variants</Text>
      </View>

      {loading ? (
        <SkeletonCardList count={4} />
      ) : error && !items.length ? (
        <ErrorNotice message={error} onRetry={refresh} />
      ) : (
        <FlatList
          testID="products-grid"
          data={items}
          numColumns={2}
          keyExtractor={(p) => p.id}
          columnWrapperStyle={{ gap: spacing.md, paddingHorizontal: spacing.xl }}
          contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: 120, gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
          renderItem={({ item }) => (
            <Pressable
              testID={`product-card-${item.id}`}
              disabled={!isOwner}
              onPress={() => router.push({ pathname: "/product/[id]", params: { id: item.id } })}
              style={styles.card}
            >
              <View style={styles.imageWrap}>
                {item.image_url ? (
                  <Image source={item.image_url} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
                    <Ionicons name="image-outline" size={32} color={colors.onSurfaceTertiary} />
                  </View>
                )}
                {!item.active && (
                  <View style={styles.inactiveBadge}>
                    <Text style={styles.inactiveText}>Inactive</Text>
                  </View>
                )}
              </View>
              <View style={{ padding: spacing.md }}>
                <Text style={styles.pname} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.pprice}>{formatIDR(item.price)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}

      {isOwner ? (
        <Pressable
          testID="new-product-fab"
          onPress={() => router.push({ pathname: "/product/[id]", params: { id: "new" } })}
          style={[styles.fab, { bottom: insets.bottom + 80 }]}
        >
          <Ionicons name="add" size={28} color={colors.onBrandPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.md },
  title: { fontSize: type["2xl"], fontWeight: "800", color: colors.onSurface },
  subtitle: { color: colors.onSurfaceTertiary, marginTop: 2 },
  card: {
    flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, overflow: "hidden",
    shadowColor: "#000", shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 1,
  },
  imageWrap: { width: "100%", aspectRatio: 1, backgroundColor: colors.surfaceTertiary },
  placeholder: { alignItems: "center", justifyContent: "center" },
  pname: { fontSize: type.base, fontWeight: "700", color: colors.onSurface },
  pprice: { color: colors.brandPrimary, fontWeight: "700", marginTop: 2, fontVariant: ["tabular-nums"] },
  inactiveBadge: {
    position: "absolute", top: 8, right: 8, backgroundColor: "rgba(41,37,36,0.85)",
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.pill,
  },
  inactiveText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  fab: {
    position: "absolute", right: spacing.xl, width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
});
