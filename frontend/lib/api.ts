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

// ── image cleaning ──────────────────────────────────────────────────────────

/**
 * The models offered for a cleaning run. "Sparkle" is our label for them;
 * every one is Gemini underneath, and `id` is what the backend forwards.
 */
export const CLEANING_MODELS = [
  {
    id: "gemini-3-pro-image",
    label: "Sparkle 3 Pro Image",
    quality: "4K",
    description: "Highest fidelity · complex detail",
    badge: "Best quality",
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Sparkle 3.1 Flash Image",
    quality: "4K",
    description: "Optimised for speed · high volume",
    badge: "Fast",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Sparkle 2.5 Flash Image",
    quality: "1K",
    description: "Budget-friendly · quick turnaround",
    badge: "Budget",
  },
] as const;

export type CleaningModelId = (typeof CLEANING_MODELS)[number]["id"];

/** Model id → Sparkle label, for a history row from before the backend recorded the label itself. */
export const MODEL_LABELS: Record<string, string> = Object.fromEntries(CLEANING_MODELS.map((m) => [m.id, m.label]));

export const DEFAULT_CLEANING_MODEL: CleaningModelId = "gemini-3-pro-image";

/**
 * Same list, generic name — Chat to Edit (and every future image tool) uses
 * the identical set of models, since the backend routes them through one
 * shared map rather than each tool having its own. `CLEANING_MODELS` stays as
 * the name the cleaning page already imports.
 */
export const SPARKLE_MODELS = CLEANING_MODELS;
export type SparkleModelId = CleaningModelId;
export const DEFAULT_SPARKLE_MODEL = DEFAULT_CLEANING_MODEL;

/**
 * Shared shape a model dropdown expects — built once from a models list
 * rather than in every page. The explicit return type matters: without it,
 * TS widens `entry.id`'s literal union to plain `string`, which is what let
 * a caller's `onModelChange` mismatch its own state setter's type.
 */
export function toModelOptions<T extends { id: string; label: string; quality: string }>(
  models: readonly T[]
): { value: T["id"]; label: string; quality: string }[] {
  return models.map((entry) => ({ value: entry.id, label: entry.label, quality: entry.quality }));
}

export type CleaningResult = {
  /** The cleaned image, as a data URI ready to render. */
  result?: string;
  model?: string;
  conversationId?: string | null;
  generationId?: string | null;
};

/** First pass: an uploaded photo in, a cleaned one out. */
export function cleanImage(body: {
  /** Data URI. Compressed in the browser before it gets here. */
  image: string;
  model: CleaningModelId;
  /** Replaces the built-in cleaning prompt entirely when given. */
  customPrompt?: string;
  /** Set to keep a retry in the same thread as the run it follows. */
  conversationId?: string | null;
}) {
  return apiRequest<CleaningResult>("/api/cleaning", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** A follow-up on a result already produced — "make the gold warmer". */
export function refineImage(body: {
  /** The image being refined, as a data URI. */
  refineImage: string;
  instruction: string;
  model: CleaningModelId;
  /** Visual inspiration only — never copied into the result wholesale. */
  referenceImages?: string[];
  conversationId?: string | null;
  parentGenerationId?: string | null;
}) {
  return apiRequest<CleaningResult>("/api/cleaning", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── chat to edit ─────────────────────────────────────────────────────────────

export type ChatEditResult = {
  /** One result image per call today — always length 1 — as a data URI. */
  images?: string[];
  model?: string;
  conversationId?: string | null;
  generationId?: string | null;
};

/**
 * One turn of a chat-style edit. Unlike cleaning there's no "default" prompt
 * mode — `instruction` always drives the edit, so it's required.
 */
export function chatEdit(body: {
  /** The image being edited this turn, as a data URI. */
  image: string;
  /** Visual inspiration only — never copied into the result wholesale. */
  referenceImages?: string[];
  /** What's actually sent to the model. */
  instruction: string;
  /** What the UI shows for this turn. Falls back to `instruction` server-side if omitted. */
  displayPrompt?: string;
  model: SparkleModelId;
  conversationId?: string | null;
  parentGenerationId?: string | null;
}) {
  return apiRequest<ChatEditResult>("/api/chat-to-edit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── history ──────────────────────────────────────────────────────────────────

export type HistoryOutput = { assetId: string; url: string; width: number | null; height: number | null };

export type HistoryItem = {
  id: string;
  conversationId: string;
  tool: string;
  model?: string | null;
  quality?: string | null;
  /** Whether the current caller is the one who ran this generation. */
  isOwn: boolean;
  userName: string;
  createdAt: string;
  outputs: HistoryOutput[];
};

export type ConversationAsset = { url: string; role: string };
export type ConversationTurn = {
  id: string;
  sequence: number;
  userPrompt: string | null;
  model?: string | null;
  quality?: string | null;
  inputAssets: ConversationAsset[];
  outputAssets: ConversationAsset[];
};

/**
 * The full thread behind one History tile, in turn order — fetched when a
 * tool page is asked to resume a past conversation rather than start fresh.
 * Only the conversation's own owner can fetch it; the server 403s otherwise.
 */
export function fetchConversation(conversationId: string) {
  return apiRequest<{ tool: string; generations: ConversationTurn[] }>(`/api/history/conversations/${conversationId}`);
}

/**
 * `fetchConversation`, pre-validated for one specific tool's page — every
 * resuming page needs the same "did this load, and is it actually mine"
 * check before touching its own state, so it lives here once instead of
 * being repeated per tool. Returns null on any failure (not found, wrong
 * tool, empty thread) so the caller can just bail out.
 */
export async function fetchConversationForTool(conversationId: string, tool: string) {
  const res = await fetchConversation(conversationId);
  if (res.status !== "success" || res.tool !== tool || res.generations.length === 0) return null;
  return res.generations;
}

/** Finds a model by id or (for a history row recorded before the id was, or a resumed label) by its Sparkle label. */
export function resolveModelId<T extends { id: string; label: string }>(
  models: readonly T[],
  value?: string | null
): T["id"] | undefined {
  return models.find((m) => m.id === value || m.label === value)?.id;
}

/**
 * One page of completed generations, newest first — the caller's own work
 * unless `scope: "team"` is given, which the server only honours when the
 * caller holds `result.read.others` (see `canReadTeam` in the response).
 * `before` is the `nextCursor` from a previous page — omit it for the first
 * page. `tool` narrows to one tool's generations; omit (or "all") for every
 * tool.
 */
export function fetchHistory(params: { tool?: string; before?: string; limit?: number; scope?: "own" | "team" } = {}) {
  const query = new URLSearchParams();
  if (params.tool && params.tool !== "all") query.set("tool", params.tool);
  if (params.before) query.set("before", params.before);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.scope === "team") query.set("scope", "team");
  const qs = query.toString();
  return apiRequest<{ items: HistoryItem[]; nextCursor: string | null; canReadTeam: boolean }>(
    `/api/history${qs ? `?${qs}` : ""}`
  );
}

/** Permanently removes one generation (and its images) from history. */
export function deleteHistoryItem(id: string) {
  return apiRequest(`/api/history/${id}`, { method: "DELETE" });
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
