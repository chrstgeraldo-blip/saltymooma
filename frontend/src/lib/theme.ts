export const colors = {
  surface: "#FAFAF9",
  onSurface: "#292524",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#292524",
  surfaceTertiary: "#F5F5F4",
  onSurfaceTertiary: "#57534E",
  surfaceInverse: "#292524",
  onSurfaceInverse: "#FAFAF9",
  brand: "#B45309",
  brandPrimary: "#92400E",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#D97706",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#FEF3C7",
  onBrandTertiary: "#92400E",
  success: "#166534",
  onSuccess: "#FFFFFF",
  warning: "#CA8A04",
  onWarning: "#FFFFFF",
  error: "#9F1239",
  onError: "#FFFFFF",
  info: "#44403C",
  onInfo: "#FFFFFF",
  border: "#E7E5E4",
  borderStrong: "#D6D3D1",
  divider: "#F5F5F4",
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, "2xl": 32, "3xl": 48,
};

export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };

export const type = { sm: 12, base: 14, lg: 16, xl: 20, "2xl": 24 };

export const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: "Pending",     color: "#CA8A04", bg: "#FEF9C3" },
  in_progress: { label: "In Progress", color: "#92400E", bg: "#FEF3C7" },
  completed:   { label: "Completed",   color: "#166534", bg: "#DCFCE7" },
  cancelled:   { label: "Cancelled",   color: "#9F1239", bg: "#FFE4E6" },
};

export function formatIDR(n: number): string {
  const v = Math.round(n || 0);
  return "Rp " + v.toLocaleString("id-ID");
}
