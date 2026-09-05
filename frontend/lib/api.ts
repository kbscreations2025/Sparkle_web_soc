export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export type ApiUser = {
  user_id: string;
  name?: string;
  email?: string;
  role?: string;
  permissions?: string[];
};

export type ApiResult<T = Record<string, never>> = {
  status: "success" | "otp_required" | "error";
  message?: string;
} & T;

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res.json();
}

export function login(email: string, password: string) {
  return apiRequest<{ user?: ApiUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function verifyOtp(email: string, otp: string) {
  return apiRequest<{ user?: ApiUser }>("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp }),
  });
}

export function getCurrentUser() {
  return apiRequest<{ user?: ApiUser }>("/api/auth/me");
}

export function logout() {
  return apiRequest("/api/auth/logout", { method: "POST" });
}
