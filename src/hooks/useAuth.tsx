import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { authApi } from "@/api/authApi";
import { readTokens, writeTokens } from "@/api/client";
import type { User } from "@/types/domain";
import { can, type Permission } from "@/utils/permissions";

interface AuthState {
  user: User | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  hasPermission: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  useEffect(() => {
    let cancelled = false;
    const tokens = readTokens();
    if (!tokens) {
      setStatus("anonymous");
      return;
    }
    authApi
      .me()
      .then((me) => {
        if (cancelled) return;
        setUser(me);
        setStatus("authenticated");
      })
      .catch(() => {
        if (cancelled) return;
        writeTokens(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { tokens, user: nextUser } = await authApi.login(username, password);
    writeTokens(tokens);
    setUser(nextUser);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(() => {
    writeTokens(null);
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      login,
      logout,
      hasPermission: (permission: Permission) => can(user?.role, permission),
    }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
