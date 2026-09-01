import { getToken } from "./storage";

const BASE = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "") + "/api";

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  password: "Password",
  name: "Name",
  amount: "Amount",
  category: "Category",
  date: "Date",
  delivery_date: "Delivery date",
  customer_name: "Customer name",
  new_password: "New password",
  current_password: "Current password",
};

/**
 * FastAPI reports validation failures as a list of Pydantic error objects.
 * Serialising that list put raw internals (`type`, `loc`, `ctx`…) in front of
 * users, so it is turned into plain sentences here — the one place every
 * screen's errors pass through.
 */
function readableDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail.trim() || null;
  if (!Array.isArray(detail)) return null;

  const lines = detail
    .map((e: any) => {
      if (typeof e?.msg !== "string") return null;
      // Pydantic prefixes custom validators with "Value error, "
      let msg = e.msg.replace(/^value error,\s*/i, "").trim();
      // "value is not a valid email address: <why>" -> keep the useful half
      msg = msg.replace(/^value is not a valid (.+?)(?::.*)?$/i, "is not a valid $1");
      msg = msg.replace(/^field required$/i, "is required");
      if (!/^is /.test(msg)) msg = msg.charAt(0).toLowerCase() + msg.slice(1);

      const field = Array.isArray(e.loc)
        ? [...e.loc].reverse().find((p: any) => typeof p === "string" && p !== "body")
        : null;
      const label = field ? FIELD_LABELS[field] ?? field.replace(/_/g, " ") : null;
      return label ? `${label} ${msg}` : msg.charAt(0).toUpperCase() + msg.slice(1);
    })
    .filter(Boolean) as string[];

  return lines.length ? lines.join("\n") : null;
}

function statusFallback(status: number): string {
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) return "You don't have access to this.";
  if (status === 404) return "Not found.";
  if (status >= 500) return "The server had a problem. Please try again.";
  return `Something went wrong (${status}).`;
}

export async function api<T = any>(
  path: string,
  opts: RequestInit & { auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as any),
  };
  if (opts.auth !== false) {
    const token = await getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...opts, headers });
  } catch {
    // fetch only rejects on transport failure; "Failed to fetch" means nothing to a user.
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    let msg: string | null = null;
    try {
      msg = readableDetail((await res.json())?.detail);
    } catch {
      // non-JSON error body; fall through to the status message
    }
    throw new Error(msg || statusFallback(res.status));
  }
  if (res.status === 204) return undefined as any;
  return res.json();
}
