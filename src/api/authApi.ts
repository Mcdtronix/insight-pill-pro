import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { AuthTokens, User } from "@/types/domain";
import { readTokens, request, writeTokens } from "./client";

export const authApi = {
  async login(username: string, password: string): Promise<{ tokens: AuthTokens; user: User }> {
    if (config.useMock) return mockApi.login(username, password);
    const tokens = await request<AuthTokens>("/auth/login/", {
      method: "POST",
      body: { email: username, password },
      auth: false,
    });
    writeTokens(tokens);
    const raw = await request<{ id: number; email: string; name: string; role: User["role"] }>("/auth/me/");
    return { tokens, user: { id: String(raw.id), username: raw.email, fullName: raw.name, email: raw.email, role: raw.role } };
  },

  async me(): Promise<User> {
    if (config.useMock) {
      const tokens = readTokens();
      if (!tokens) throw new Error("No session");
      return mockApi.currentUser(tokens.access);
    }
    const raw = await request<{ id: number; email: string; name: string; role: User["role"] }>("/auth/me/");
    return { id: String(raw.id), username: raw.email, fullName: raw.name, email: raw.email, role: raw.role };
  },
};
