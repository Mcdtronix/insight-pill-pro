/**
 * Environment configuration.
 * Never hardcode backend URLs inside components — read them from here.
 */

const env = import.meta.env as Record<string, string | undefined>;

export const config = {
  /** Base URL of the Django REST API, e.g. http://localhost:8000/api */
  apiUrl: env["VITE_API_URL"] ?? "http://127.0.0.1:8000/api",
  /**
   * When no API URL is configured (or VITE_USE_MOCK=true) the app serves
   * data from the local mock service so the UI can be demonstrated
   * before the Django backend is connected.
   */
  useMock: env["VITE_USE_MOCK"] === "true",
  tokenStorageKey: "pdss.auth.tokens",
  requestTimeoutMs: 20000,
} as const;
