import { useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal,
  KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { router, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/src/lib/api";
import { useAuth, type Role } from "@/src/lib/auth";
import { colors, spacing, radius, type } from "@/src/lib/theme";
import { useFetch } from "@/src/hooks/use-fetch";
import { Skeleton } from "@/src/components/Skeleton";

type Staff = { id: string; email: string; name: string; role: Role };

const ROLE_META: Record<Role, { label: string; hint: string }> = {
  owner: { label: "Owner", hint: "Everything, including revenue, expenses and staff" },
  admin: { label: "Admin", hint: "Preorders, production, stock and the till — no financials" },
  cashier: { label: "Cashier", hint: "The counter only — till, stock and receipts" },
};

export default function Settings() {
  const insets = useSafeAreaInsets();
  const { user, signOut, isOwner } = useAuth();
  const [addOpen, setAddOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // Cashiers never call /users — it would 403.
  const { data, loading, refreshing, refresh, reload } = useFetch<Staff[]>(
    isOwner ? "staff" : "none",
    async () => (isOwner ? api<Staff[]>("/users") : [])
  );
  const staff = data ?? [];

  // Settings sits outside (tabs), so it has no layout guard of its own — without
  // this, signing out clears the session but leaves you staring at this screen.
  if (!user) return <Redirect href="/login" />;

  const remove = async (id: string) => {
    setConfirmId(null);
    await api(`/users/${id}`, { method: "DELETE" });
    reload({ refresh: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <View style={s.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} testID="settings-back">
          <Ionicons name="chevron-back" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title}>Settings</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.xl, paddingBottom: 60 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {/* Account */}
        <Text style={s.section}>Account</Text>
        <View style={s.card}>
          <View style={s.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{user?.name}</Text>
              <Text style={s.sub}>{user?.email}</Text>
            </View>
            <View style={s.roleChip}>
              <Text style={s.roleChipText}>{ROLE_META[user?.role ?? "owner"].label}</Text>
            </View>
          </View>
          <Pressable style={s.secondaryBtn} onPress={() => setPwOpen(true)} testID="change-password">
            <Ionicons name="key-outline" size={16} color={colors.brandPrimary} />
            <Text style={s.secondaryText}>Change password</Text>
          </Pressable>
        </View>

        {/* Staff — owner only */}
        {isOwner ? (
          <>
            <Text style={s.section}>Staff</Text>
            <Text style={s.sectionHint}>
              Accounts can only be created here. There is no public sign-up.
            </Text>
            {loading ? (
              <View style={s.card}>
                {[0, 1].map((i) => (
                  <Skeleton key={i} height={40} style={{ marginBottom: spacing.sm }} />
                ))}
              </View>
            ) : (
              <View style={s.card}>
                {staff.map((m, i) => (
                  <View key={m.id} style={[s.staffRow, i > 0 && s.staffRowDivider]}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.staffName}>{m.name}</Text>
                      <Text style={s.sub}>{m.email}</Text>
                      <Text style={s.roleHint}>{ROLE_META[m.role].label}</Text>
                    </View>
                    {m.id === user?.id ? (
                      <Text style={s.youTag}>you</Text>
                    ) : confirmId === m.id ? (
                      <View style={s.confirmRow}>
                        <Pressable onPress={() => setConfirmId(null)} style={s.confirmCancel}>
                          <Text style={s.confirmCancelText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => remove(m.id)}
                          style={s.confirmDelete}
                          testID={`confirm-remove-${m.email}`}
                        >
                          <Text style={s.confirmDeleteText}>Remove</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => setConfirmId(m.id)}
                        hitSlop={8}
                        testID={`remove-${m.email}`}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.error} />
                      </Pressable>
                    )}
                  </View>
                ))}
                <Pressable style={s.secondaryBtn} onPress={() => setAddOpen(true)} testID="add-staff">
                  <Ionicons name="person-add-outline" size={16} color={colors.brandPrimary} />
                  <Text style={s.secondaryText}>Add staff member</Text>
                </Pressable>
              </View>
            )}
          </>
        ) : null}

        <Pressable style={s.signOut} onPress={signOut} testID="settings-signout">
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={s.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>

      <AddStaffModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => { setAddOpen(false); reload({ refresh: true }); }}
      />
      <PasswordModal visible={pwOpen} onClose={() => setPwOpen(false)} />
    </View>
  );
}

function AddStaffModal({
  visible, onClose, onCreated,
}: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => { setName(""); setEmail(""); setPassword(""); setRole("cashier"); setError(null); };

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      await api("/users", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, role }),
      });
      reset();
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Could not create account");
    } finally { setBusy(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={s.sheet} testID="add-staff-modal">
          <Text style={s.sheetTitle}>Add staff member</Text>

          <Text style={s.label}>Name</Text>
          <TextInput style={s.input} value={name} onChangeText={setName}
            placeholder="e.g. Kasir Pagi" placeholderTextColor={colors.onSurfaceTertiary}
            testID="staff-name" />

          <Text style={s.label}>Email</Text>
          <TextInput style={s.input} value={email} onChangeText={setEmail}
            autoCapitalize="none" keyboardType="email-address"
            placeholder="kasir@saltbread.com" placeholderTextColor={colors.onSurfaceTertiary}
            testID="staff-email" />

          <Text style={s.label}>Password</Text>
          <TextInput style={s.input} value={password} onChangeText={setPassword}
            secureTextEntry placeholder="At least 6 characters"
            placeholderTextColor={colors.onSurfaceTertiary} testID="staff-password" />

          <Text style={s.label}>Role</Text>
          <View style={s.roleRow}>
            {(Object.keys(ROLE_META) as Role[]).map((r) => (
              <Pressable
                key={r}
                onPress={() => setRole(r)}
                style={[s.roleOption, role === r && s.roleOptionActive]}
                testID={`role-${r}`}
              >
                <Text style={[s.roleOptionLabel, role === r && { color: colors.brandPrimary }]}>
                  {ROLE_META[r].label}
                </Text>
                <Text style={s.roleOptionHint}>{ROLE_META[r].hint}</Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={s.error} testID="staff-error">{error}</Text> : null}

          <View style={s.sheetActions}>
            <Pressable onPress={onClose} style={[s.sheetBtn, { backgroundColor: colors.surfaceTertiary }]}>
              <Text style={[s.sheetBtnText, { color: colors.onSurface }]}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={busy}
              style={[s.sheetBtn, { backgroundColor: colors.brandPrimary }]}
              testID="staff-submit"
            >
              <Text style={[s.sheetBtnText, { color: colors.onBrandPrimary }]}>
                {busy ? "Creating…" : "Create"}
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      await api("/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      setCurrent(""); setNext(""); setDone(true);
    } catch (e: any) {
      setError(e?.message || "Could not change password");
    } finally { setBusy(false); }
  };

  const close = () => { setDone(false); setError(null); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={s.overlay}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={s.sheet} testID="password-modal">
          <Text style={s.sheetTitle}>Change password</Text>
          {done ? (
            <>
              <Text style={s.doneText}>Password updated.</Text>
              <Pressable onPress={close} style={[s.sheetBtn, { backgroundColor: colors.brandPrimary }]}>
                <Text style={[s.sheetBtnText, { color: colors.onBrandPrimary }]}>Done</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={s.label}>Current password</Text>
              <TextInput style={s.input} value={current} onChangeText={setCurrent}
                secureTextEntry testID="pw-current" />
              <Text style={s.label}>New password</Text>
              <TextInput style={s.input} value={next} onChangeText={setNext}
                secureTextEntry placeholder="At least 6 characters"
                placeholderTextColor={colors.onSurfaceTertiary} testID="pw-new" />
              {error ? <Text style={s.error} testID="pw-error">{error}</Text> : null}
              <View style={s.sheetActions}>
                <Pressable onPress={close} style={[s.sheetBtn, { backgroundColor: colors.surfaceTertiary }]}>
                  <Text style={[s.sheetBtnText, { color: colors.onSurface }]}>Cancel</Text>
                </Pressable>
                <Pressable onPress={submit} disabled={busy}
                  style={[s.sheetBtn, { backgroundColor: colors.brandPrimary }]} testID="pw-submit">
                  <Text style={[s.sheetBtnText, { color: colors.onBrandPrimary }]}>
                    {busy ? "Saving…" : "Update"}
                  </Text>
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
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
  },
  title: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface },
  section: {
    fontSize: type.sm, fontWeight: "700", color: colors.onSurfaceTertiary,
    textTransform: "uppercase", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  sectionHint: { color: colors.onSurfaceTertiary, fontSize: type.sm, marginBottom: spacing.sm },
  card: {
    backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg,
    padding: spacing.lg, marginBottom: spacing.md,
  },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { fontSize: type.lg, fontWeight: "700", color: colors.onSurface },
  sub: { color: colors.onSurfaceTertiary, fontSize: type.sm, marginTop: 2 },
  roleChip: {
    backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md,
    paddingVertical: 4, borderRadius: radius.pill,
  },
  roleChipText: { color: colors.brandPrimary, fontWeight: "800", fontSize: 11 },
  roleHint: { color: colors.brandPrimary, fontSize: 11, fontWeight: "700", marginTop: 3 },
  staffRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md },
  staffRowDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  staffName: { fontWeight: "700", color: colors.onSurface },
  youTag: { color: colors.onSurfaceTertiary, fontSize: type.sm, fontStyle: "italic" },
  confirmRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  confirmCancel: { paddingHorizontal: spacing.md, paddingVertical: 6 },
  confirmCancelText: { color: colors.onSurfaceTertiary, fontWeight: "600", fontSize: type.sm },
  confirmDelete: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.pill, backgroundColor: colors.error,
  },
  confirmDeleteText: { color: colors.onError, fontWeight: "700", fontSize: type.sm },
  secondaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    marginTop: spacing.md, height: 42, borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
  },
  secondaryText: { color: colors.brandPrimary, fontWeight: "700" },
  signOut: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    marginTop: spacing.xl, height: 46, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary,
  },
  signOutText: { color: colors.error, fontWeight: "700" },
  overlay: {
    flex: 1, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.35)", padding: spacing.xl,
  },
  sheet: {
    width: "100%", maxWidth: 420, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.xl,
  },
  sheetTitle: { fontSize: type.xl, fontWeight: "800", color: colors.onSurface, marginBottom: spacing.md },
  label: { fontSize: type.sm, fontWeight: "600", color: colors.onSurfaceTertiary, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, height: 46,
    fontSize: type.base, color: colors.onSurface,
  },
  roleRow: { gap: spacing.sm },
  roleOption: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    padding: spacing.md,
  },
  roleOptionActive: { borderColor: colors.brandPrimary, backgroundColor: colors.brandTertiary },
  roleOptionLabel: { fontWeight: "800", color: colors.onSurface },
  roleOptionHint: { color: colors.onSurfaceTertiary, fontSize: type.sm, marginTop: 2 },
  error: { color: colors.error, marginTop: spacing.md },
  doneText: { color: colors.onSurface, marginBottom: spacing.lg },
  sheetActions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.lg },
  sheetBtn: { flex: 1, height: 46, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  sheetBtnText: { fontWeight: "700" },
});
