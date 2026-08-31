import { useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, type } from "@/src/lib/theme";
import { toISODate, parseISODate, formatHuman } from "@/src/lib/date";

/**
 * Month-grid date picker. Built in RN rather than pulling a native picker so it
 * behaves identically on web, iOS and Android — this app ships all three.
 */

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = ["January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December"];

/**
 * The month grid on its own — usable inline, so callers already inside a Modal
 * don't have to nest one (nested Modals misbehave on iOS).
 */
export function CalendarGrid({
  value,
  onChange,
}: {
  value: string;
  onChange: (iso: string) => void;
}) {
  const selected = parseISODate(value) ?? new Date();
  const [view, setView] = useState(() => new Date(selected.getFullYear(), selected.getMonth(), 1));

  const cells = useMemo(() => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const leading = (new Date(y, m, 1).getDay() + 6) % 7; // Monday-first
    const days = new Date(y, m + 1, 0).getDate();
    return [
      ...Array.from({ length: leading }, () => null),
      ...Array.from({ length: days }, (_, i) => new Date(y, m, i + 1)),
    ];
  }, [view]);

  const todayISO = toISODate(new Date());
  const shiftMonth = (delta: number) =>
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));

  return (
    <View>
      <View style={s.head}>
        <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={s.navBtn}>
          <Ionicons name="chevron-back" size={18} color={colors.onSurface} />
        </Pressable>
        <Text style={s.monthTitle}>
          {MONTHS[view.getMonth()]} {view.getFullYear()}
        </Text>
        <Pressable onPress={() => shiftMonth(1)} hitSlop={10} style={s.navBtn}>
          <Ionicons name="chevron-forward" size={18} color={colors.onSurface} />
        </Pressable>
      </View>

      <View style={s.grid}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={s.weekday}>{w}</Text>
        ))}
        {cells.map((d, i) => {
          if (!d) return <View key={`b${i}`} style={s.cell} />;
          const iso = toISODate(d);
          const isSelected = iso === value;
          const isToday = iso === todayISO;
          return (
            <Pressable
              key={iso}
              testID={`day-${iso}`}
              onPress={() => onChange(iso)}
              style={[s.cell, isSelected && s.cellSelected, !isSelected && isToday && s.cellToday]}
            >
              <Text style={[s.cellText, isSelected && s.cellTextSelected]}>{d.getDate()}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable style={s.todayBtn} onPress={() => onChange(todayISO)}>
        <Text style={s.todayText}>Today</Text>
      </Pressable>
    </View>
  );
}

/** Labelled field that opens the grid in its own modal. */
export function CalendarField({
  label,
  value,
  onChange,
  testID,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);

  const pick = (iso: string) => {
    onChange(iso);
    setOpen(false);
  };

  return (
    <>
      <Text style={s.label}>{label}</Text>
      <Pressable testID={testID} style={s.field} onPress={() => setOpen(true)}>
        <Text style={s.fieldText}>{formatHuman(value)}</Text>
        <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceTertiary} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(false)} />
          <View style={s.sheet}>
            <CalendarGrid value={value} onChange={pick} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  label: { fontSize: type.sm, fontWeight: "600", color: colors.onSurfaceTertiary, marginBottom: spacing.xs },
  field: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, height: 46, backgroundColor: colors.surfaceSecondary,
  },
  fieldText: { color: colors.onSurface, fontSize: type.base, fontWeight: "600" },
  overlay: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.35)", padding: spacing.xl },
  sheet: {
    width: "100%", maxWidth: 360, backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg, padding: spacing.lg,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  monthTitle: { fontSize: type.lg, fontWeight: "800", color: colors.onSurface },
  navBtn: {
    width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: {
    width: `${100 / 7}%`, textAlign: "center", fontSize: 11, fontWeight: "700",
    color: colors.onSurfaceTertiary, marginBottom: spacing.xs,
  },
  cell: { width: `${100 / 7}%`, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  cellSelected: { backgroundColor: colors.brandPrimary },
  cellToday: { borderWidth: 1, borderColor: colors.brandSecondary },
  cellText: { color: colors.onSurface, fontSize: type.base, fontVariant: ["tabular-nums"] },
  cellTextSelected: { color: colors.onBrandPrimary, fontWeight: "800" },
  todayBtn: {
    marginTop: spacing.md, height: 40, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary,
  },
  todayText: { color: colors.brandPrimary, fontWeight: "700" },
});
