import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { Redirect } from "expo-router";
import { useAuth } from "@/src/lib/auth";
import { colors } from "@/src/lib/theme";

export default function Index() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.container} testID="index-splash">
        <ActivityIndicator size="large" color={colors.brandPrimary} />
      </View>
    );
  }

  if (!user) return <Redirect href="/login" />;
  return <Redirect href="/(tabs)/dashboard" />;
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
});
