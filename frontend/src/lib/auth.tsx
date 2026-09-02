import React, { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { getToken, setToken, getUser, setUser } from "./storage";

export type Role = "owner" | "admin" | "cashier";
export type User = { id: string; email: string; name: string; role: Role };

type Ctx = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  isOwner: boolean;
  /** owner or admin — runs operations, but only the owner sees money. */
  isStaff: boolean;
};

const AuthContext = createContext<Ctx | null>(null);
export const useAuth = () => {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth outside provider");
  return c;
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      const u = await getUser();
      if (t && u) setUserState(u);
      setLoading(false);
    })();
  }, []);

  const applyLogin = async (data: { access_token: string; user: User }) => {
    await setToken(data.access_token);
    await setUser(data.user);
    setUserState(data.user);
  };

  const signIn = async (email: string, password: string) => {
    const data = await api<{ access_token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
      auth: false,
    });
    await applyLogin(data);
  };

  const signOut = async () => {
    await setToken(null);
    await setUser(null);
    setUserState(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, isOwner: user?.role === "owner",
        isStaff: user?.role === "owner" || user?.role === "admin" }}>
      {children}
    </AuthContext.Provider>
  );
}
