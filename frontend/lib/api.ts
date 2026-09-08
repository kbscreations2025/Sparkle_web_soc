export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

export type ApiUser = {
  user_id: string;
  name?: string;
  email?: string;
  /** Display label from our own database — never used to decide access. */
  role?: string;
  /** Our database's grants. Central's own permissions are deliberately absent. */
  permissions?: string[];
  /** The one field the central login contributes: it picks which shell renders. */
  isSuperAdmin?: boolean;
  permissionVersion?: number;
  tenantId?: string | null;
};

/** One of the user's existing logins, shown so they can see what they'd end. */
export type ActiveSession = {
  session_id: string;
  ip_address?: string;
  user_agent?: string;
  created_at?: string;
};

export type ApiResult<T = Record<string, never>> = {
  status: "success" | "otp_required" | "session_limit_reached" | "error";
  message?: string;
} & T;

/** Extra fields the login and OTP endpoints return alongside `status`. */
export type AuthPayload = {
  user?: ApiUser;
  /** Present on session_limit_reached. */
  max_active_sessions?: number;
  active_sessions?: ActiveSession[];
  /** Present on otp_required. */
  otp_expires_at?: string;
};

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

/**
 * `forceLogoutOthers` is only ever true on a deliberate retry, after the user
 * has seen their other sessions and confirmed. Both endpoints require the retry
 * to repeat the original credentials, which is why the caller has to keep them.
 */
export function login(email: string, password: string, forceLogoutOthers = false) {
  return apiRequest<AuthPayload>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password, force_logout_others: forceLogoutOthers }),
  });
}

export function verifyOtp(email: string, otp: string, forceLogoutOthers = false) {
  return apiRequest<AuthPayload>("/api/auth/verify-otp", {
    method: "POST",
    body: JSON.stringify({ email, otp, force_logout_others: forceLogoutOthers }),
  });
}

export function getCurrentUser() {
  return apiRequest<{ user?: ApiUser }>("/api/auth/me");
}

export function logout() {
  return apiRequest("/api/auth/logout", { method: "POST" });
}

// ── super-admin console ─────────────────────────────────────────────────────
// Every endpoint below is super-admin only, enforced in
// `backend/src/routes/admin.js`. A 403 here means the session isn't one.

export type Organization = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "trial" | "suspended" | "archived";
  aiProviderCount: number;
  memberCount: number;
  /** How many members carry the admin label. */
  adminCount: number;
  createdAt?: string;
};

export type DataScope = {
  kind: "own" | "organization" | "selected";
  userIds?: string[];
  toolKeys?: string[];
  notBefore?: string;
  canExport?: boolean;
};

export type Member = {
  id: string;
  name?: string;
  email: string;
  role: string;
  status: "invited" | "active" | "suspended" | "removed";
  permissions: string[];
  dataScope: DataScope;
  permissionVersion: number;
  /** False until this person has signed in and been matched to a central identity. */
  linked: boolean;
  lastLoginAt?: string;
  authUserId?: string | null;
  /** Open connections right now, from the socket layer. 0 means idle. */
  liveSessions: number;
};

/** One assignable permission, as the backend defines it. */
export type GrantOption = { grant: string; label: string; hint?: string };
export type GrantGroup = { id: string; label: string; grants: GrantOption[] };

export function getGrantCatalogue() {
  return apiRequest<{ groups?: GrantGroup[]; scopeKinds?: string[]; providers?: AiProviderName[] }>(
    "/api/admin/grants"
  );
}

export function listOrganizations() {
  return apiRequest<{ organizations?: Organization[] }>("/api/admin/organizations");
}

export function createOrganization(name: string) {
  return apiRequest<{ organization?: Organization }>("/api/admin/organizations", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function updateOrganization(id: string, patch: { name?: string; status?: string }) {
  return apiRequest<{ organization?: Organization }>(`/api/admin/organizations/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function listMembers(orgId: string) {
  return apiRequest<{ organization?: Organization; members?: Member[] }>(
    `/api/admin/organizations/${orgId}/members`
  );
}

export function addMember(
  orgId: string,
  body: {
    email: string;
    name?: string;
    role?: string;
    /** From the central list, so the row links without waiting for a first login. */
    authUserId?: string;
    permissions?: string[];
    dataScope?: DataScope;
  }
) {
  return apiRequest<{ member?: Member }>(`/api/admin/organizations/${orgId}/members`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateMember(
  memberId: string,
  patch: { name?: string; role?: string; status?: string; permissions?: string[]; dataScope?: DataScope }
) {
  return apiRequest<{ member?: Member }>(`/api/admin/members/${memberId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/**
 * Someone the central login has registered against this application, fetched
 * with the service's client id/secret. This is both the read-only directory
 * the console shows, and the only pool a super admin can pick from when
 * adding someone to an organization — there is no endpoint to add a user from
 * here, only to see who central already knows.
 */
export type AppUser = {
  user_id: string;
  name?: string;
  email: string;
  status?: string;
  /** Central's own role label. Shown for reference; it grants nothing here. */
  role?: string;
  grantedAt?: string;
  /** Where we already know them, or null if they're not in any organization yet. */
  organization: { id: string; name: string; slug: string } | null;
  memberId: string | null;
};

export function listAppUsers() {
  return apiRequest<{ users?: AppUser[] }>("/api/admin/app-users");
}

/**
 * Free-form on purpose: the real list is the backend's `Tenant.PROVIDERS`,
 * served by `getGrantCatalogue()`. Pinning a union here would mean editing two
 * files to add one provider.
 */
export type AiProviderName = string;

/** A tenant's stored AI provider key — the credential itself never leaves the server. */
export type AiProvider = {
  id: string;
  provider: AiProviderName;
  label: string;
  /** Last few characters only — enough to tell keys apart, not enough to use. */
  keyHint: string;
  orgId?: string | null;
  enabled: boolean;
  priority: number;
  health?: {
    lastUsedAt?: string;
    lastSuccessAt?: string;
    lastErrorAt?: string;
    lastErrorCode?: string;
    consecutiveFailures?: number;
  };
  createdAt?: string;
};

export function listAiProviders(orgId: string) {
  return apiRequest<{ providers?: AiProvider[] }>(`/api/admin/organizations/${orgId}/ai-providers`);
}

export function addAiProvider(
  orgId: string,
  body: { provider: AiProviderName; label: string; apiKey: string; orgId?: string; priority?: number; enabled?: boolean }
) {
  return apiRequest<{ provider?: AiProvider }>(`/api/admin/organizations/${orgId}/ai-providers`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateAiProvider(
  orgId: string,
  providerId: string,
  patch: { label?: string; apiKey?: string; orgId?: string; priority?: number; enabled?: boolean }
) {
  return apiRequest<{ provider?: AiProvider }>(`/api/admin/organizations/${orgId}/ai-providers/${providerId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteAiProvider(orgId: string, providerId: string) {
  return apiRequest(`/api/admin/organizations/${orgId}/ai-providers/${providerId}`, { method: "DELETE" });
}

export function deleteOrganization(id: string) {
  return apiRequest<{ removedMembers?: number }>(`/api/admin/organizations/${id}`, {
    method: "DELETE",
  });
}

export function deleteMember(memberId: string) {
  return apiRequest(`/api/admin/members/${memberId}`, { method: "DELETE" });
}

/**
 * Drops this browser's session cookies without touching the central login.
 * For a client that was signed out from elsewhere: calling `logout()` instead
 * would revoke the user's trusted devices upstream, forcing a fresh OTP on the
 * device that just displaced this one.
 */
export function clearLocalSession() {
  return apiRequest("/api/auth/session/clear", { method: "POST" });
}
