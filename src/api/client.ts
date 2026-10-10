import { config } from "@/lib/config";
import type { AuthTokens } from "@/types/domain";

export class ApiError extends Error {
  status: number;
  code: "network" | "timeout" | "http";

  constructor(message: string, status: number, code: ApiError["code"] = "http") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** User-facing copy for a failure — never leaks backend stack traces. */
export function describeError(error: unknown): { title: string; detail: string } {
  if (error instanceof ApiError) {
    if (error.code === "network")
      return {
        title: "Connection problem",
        detail: "We couldn't reach the server. Check your network connection and try again.",
      };
    if (error.code === "timeout")
      return { title: "The request timed out", detail: "The server took too long to respond." };
    switch (error.status) {
      case 400:
        return { title: "Invalid request", detail: error.message || "Some of the submitted values were not accepted." };
      case 401:
        return { title: error.message === "Wrong password." ? "Wrong password" : "Sign-in failed", detail: error.message || "Please check your credentials and try again." };
      case 403:
        return { title: "Access denied", detail: "Your role does not permit this action." };
      case 404:
        return { title: "Not found", detail: "The requested record no longer exists." };
      default:
        return { title: "Something went wrong", detail: "The server could not complete the request." };
    }
  }
  return { title: "Something went wrong", detail: "An unexpected error occurred. Please try again." };
}

export function readTokens(): AuthTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(config.tokenStorageKey);
    return raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    return null;
  }
}

export function writeTokens(tokens: AuthTokens | null): void {
  if (typeof window === "undefined") return;
  if (tokens) window.localStorage.setItem(config.tokenStorageKey, JSON.stringify(tokens));
  else window.localStorage.removeItem(config.tokenStorageKey);
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  params?: Record<string, string | number | undefined>;
  auth?: boolean;
}

let refreshInFlight: Promise<AuthTokens | null> | null = null;

async function refreshAccessToken(): Promise<AuthTokens | null> {
  const tokens = readTokens();
  if (!tokens?.refresh) return null;
  refreshInFlight ??= fetch(`${config.apiUrl}/token/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh: tokens.refresh }),
  })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as { access: string; refresh?: string };
      const next = { access: data.access, refresh: data.refresh ?? tokens.refresh };
      writeTokens(next);
      return next;
    })
    .catch(() => null)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** Thin transport wrapper around the Django REST API. */
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, params, auth = true } = options;
  const url = new URL(`${config.apiUrl}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    });
  }

  const send = async (token?: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    try {
      return await fetch(url.toString(), {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response: Response;
  try {
    response = await send(auth ? readTokens()?.access : undefined);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ApiError("Request timed out", 408, "timeout");
    throw new ApiError("Network request failed", 0, "network");
  }

  if (response.status === 401 && auth) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await send(refreshed.access);
    } else {
      writeTokens(null);
      throw new ApiError("Session expired", 401);
    }
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.clone().json()) as { detail?: string; fields?: Record<string, string[]>; fieldErrors?: Record<string, string[]> };
      const fields = payload.fields ?? payload.fieldErrors;
      const firstField = fields && Object.values(fields).flat()[0];
      message = firstField ?? payload.detail ?? message;
    } catch { /* non-JSON error response */ }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
