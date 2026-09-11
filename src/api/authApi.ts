import { config } from "@/lib/config";
import { mockApi } from "@/mock/mockApi";
import type { AuthTokens, User } from "@/types/domain";
import { readTokens, request } from "./client";

export const authApi = {
  async login(username: string, password: string): Promise<{ tokens: AuthTokens; user: User }> {
    if (config.useMock) return mockApi.login(username, password);
    const tokens = await request<AuthTokens>("/token/", {
      method: "POST",
      body: { username, password },
      auth: false,
    });
    const user = await request<User>("/auth/me/", { method: "GET" });
    return { tokens, user };
  },

  async me(): Promise<User> {
    if (config.useMock) {
      const tokens = readTokens();
      if (!tokens) throw new Error("No session");
      return mockApi.currentUser(tokens.access);
    }
    return request<User>("/auth/me/");
  },
};
