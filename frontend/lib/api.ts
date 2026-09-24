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
  /** Platform staff, a separate flag from the central super admin above. */
  isPlatformAdmin?: boolean;
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
  // "queued" is what the generation routes answer with now: the work was
  // accepted onto the job queue, not finished (see fetchJobs/JobsProvider).
  status: "success" | "queued" | "otp_required" | "session_limit_reached" | "error";
  message?: string;
  /**
   * Machine-readable failure, where the message alone isn't enough to decide
   * what the UI should do — `insufficient_credits` is the one that opens a
   * dialog rather than printing into an error banner.
   */
  code?: string;
  /** Present on `insufficient_credits`: what the run costs, and what's spendable. */
  required?: number;
  available?: number;
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

  /*
   * A reply that isn't JSON is still an answer, and callers all expect the
   * `{ status }` shape. Parsing straight into `res.json()` turned a proxy
   * error page or an empty body into a thrown exception in the middle of
   * whatever the caller was doing — which, for anything without a
   * try/catch, meant no error shown and a spinner left running.
   */
  try {
    return await res.json();
  } catch {
    return {
      status: "error",
      message: res.ok
        ? "The server sent a reply this app could not read."
        : `The server returned an error (${res.status}).`,
      code: "bad_response",
    } as unknown as ApiResult<T>;
  }
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
  /** The pool plus every member's balance, with what runs in flight have frozen. */
  credits: { balance: number; reserved: number; available: number; pool: number };
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
  /** What this person can spend. 0 available means they cannot generate at all. */
  credits: { balance: number; reserved: number; available: number };
};

/** One assignable permission, as the backend defines it. */
export type GrantOption = {
  grant: string;
  label: string;
  hint?: string;
  /**
   * A real grant that is not offered as a checkbox — it is derived from
   * something else. `result.read.others` follows the data scope.
   */
  hidden?: boolean;
};
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

// ── audit log (org admin — needs org.audit.read) ────────────────────────────

export type AuditEntry = {
  id: string;
  action: string;
  status: "success" | "failure";
  actor: { userId: string | null; name: string | null; email: string | null };
  targetType: string | null;
  targetId: string | null;
  message: string | null;
  ip: string | null;
  createdAt: string;
  /**
   * Whether this row has metadata or a user agent worth expanding for. The
   * fields themselves are not in the list — they are the widest part of a row
   * and invisible until expanded, so they come from `getAuditEntryDetail`.
   */
  hasDetail: boolean;
  /** Which organization this happened in. Only sent to a super admin, who reads across all of them. */
  tenant?: string;
};

/** The filter dropdowns' contents, scoped to this organization. */
export type AuditFacets = {
  /** Only the actions this organization has actually produced. */
  actions: string[];
  targetTypes: string[];
  actors: { id: string; name: string; email: string }[];
  /** Super admin only: the organizations available to filter by. */
  tenants?: { id: string; name: string }[];
};

export type AuditQuery = {
  action?: string[];
  /** Repeatable: any of these outcomes. */
  status?: ("success" | "failure")[];
  /** Repeatable, like `action`: any of these people. */
  actorUserId?: string[];
  targetType?: string;
  /** Matches the message, actor name or actor email. */
  q?: string;
  from?: string;
  to?: string;
  /** Cursor: the `nextCursor` from the previous page. */
  before?: string;
  limit?: number;
  /**
   * Narrows to one organization. Accepted from a super admin only — for anyone
   * else the backend ignores it and scopes to their own tenant regardless, so
   * sending it can never widen what they see.
   */
  tenantId?: string[];
};

/**
 * One page of the audit trail, newest first.
 *
 * For an org user this is only ever their own organization: the backend takes
 * the tenant from the session and refuses any filter that would widen it. A
 * central super admin reads across every organization and may narrow to one
 * with `tenantId`.
 */
export function listAuditLog(query: AuditQuery = {}) {
  const params = new URLSearchParams();
  // Repeated key rather than a joined string: the backend reads ?action=a&action=b
  // as an array, which is what the multi-select sends.
  query.action?.forEach((value) => params.append("action", value));
  query.status?.forEach((value) => params.append("status", value));
  query.actorUserId?.forEach((value) => params.append("actorUserId", value));
  if (query.targetType) params.set("targetType", query.targetType);
  if (query.q) params.set("q", query.q);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  if (query.before) params.set("before", query.before);
  if (query.limit) params.set("limit", String(query.limit));
  query.tenantId?.forEach((value) => params.append("tenantId", value));

  const qs = params.toString();
  return apiRequest<{ entries?: AuditEntry[]; hasMore?: boolean; nextCursor?: string | null }>(
    `/api/audit-log${qs ? `?${qs}` : ""}`
  );
}

export function getAuditFacets() {
  return apiRequest<AuditFacets>("/api/audit-log/facets");
}

/** The heavy half of one row, fetched when it is expanded. */
export function getAuditEntryDetail(id: string) {
  return apiRequest<{ metadata?: Record<string, unknown>; userAgent?: string | null }>(
    `/api/audit-log/${id}`
  );
}

// ── credit pricing (super admin only) ───────────────────────────────────────

export type PricingUnit = "per_image" | "per_request" | "per_second";

/**
 * One row of the price table: what a provider charges us for a unit of work,
 * and what we charge the customer for it. See
 * backend/src/models/creditPricingRule.js for why both live on one row.
 */
export type PricingRule = {
  id: string;
  label: string;
  /** Null = applies to every organization. */
  tenantId: string | null;
  tool: string | null;
  modelId: string | null;
  quality: string | null;
  unit: PricingUnit;
  /** The provider's own published rate. Null when none has been recorded. */
  providerRate: number | null;
  providerCurrency: string;
  creditsPerUnit: number;
  notes: string | null;
  active: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The dropdown contents for the pricing form — the backend owns these lists. */
export type PricingCatalogue = {
  units: PricingUnit[];
  currencies: string[];
  /** Rupees to the dollar, for showing a provider rate in both. Indicative. */
  usdToInr: number;
  tools: string[];
  models: { group: string; models: { id: string; label: string; qualities: string[] }[] }[];
  organizations: { id: string; name: string; slug: string }[];
};

export type PricingRuleInput = {
  label: string;
  tenantId?: string | null;
  tool?: string | null;
  modelId?: string | null;
  quality?: string | null;
  unit?: PricingUnit;
  providerRate?: number | string | null;
  providerCurrency?: string;
  creditsPerUnit: number | string;
  notes?: string | null;
};

export function getPricingCatalogue() {
  return apiRequest<PricingCatalogue>("/api/admin/pricing/catalogue");
}

export function listPricingRules(includeRetired = false) {
  return apiRequest<{ rules?: PricingRule[] }>(
    `/api/admin/pricing${includeRetired ? "?includeRetired=true" : ""}`
  );
}

export function createPricingRule(body: PricingRuleInput) {
  return apiRequest<{ rule?: PricingRule }>("/api/admin/pricing", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updatePricingRule(id: string, patch: Partial<PricingRuleInput>) {
  return apiRequest<{ rule?: PricingRule }>(`/api/admin/pricing/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/**
 * Retires a rule by default, which keeps it on record. `purge` removes the
 * row outright — only for one created by mistake that never priced anything.
 */
export function deletePricingRule(id: string, purge = false) {
  return apiRequest<{ rule?: PricingRule }>(
    `/api/admin/pricing/${id}${purge ? "?purge=true" : ""}`,
    { method: "DELETE" }
  );
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
    qualities: ["4K", "2K", "1K"],
    description: "Highest fidelity · complex detail",
    badge: "Best quality",
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Sparkle 3.1 Flash Image",
    quality: "4K",
    qualities: ["4K", "2K", "1K"],
    description: "Optimised for speed · high volume",
    badge: "Fast",
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Sparkle 2.5 Flash Image",
    quality: "1K",
    qualities: ["1K"],
    description: "Budget-friendly · quick turnaround",
    badge: "Budget",
  },
] as const;

/**
 * The sizes a model can actually be run at, and the one it defaults to.
 *
 * `qualities` mirrors `GEMINI_IMAGE_QUALITIES` in backend/src/gemini.js — one
 * lives in each language, so they are kept in step by hand. The backend is
 * the authority: it re-resolves whatever arrives against the same table and
 * falls back to the model's best, so a list that drifts here degrades to a
 * picker offering the wrong options rather than to a failed generation.
 *
 * `quality` stays as the default (and as the badge the cleaning workspace
 * shows), which is always the first and best entry in `qualities`.
 */
export function qualitiesFor(modelId: string): readonly string[] {
  return CLEANING_MODELS.find((m) => m.id === modelId)?.qualities ?? ["1K"];
}

/** The size a freshly-picked model starts on — its best. */
export function defaultQualityFor(modelId: string): string {
  return qualitiesFor(modelId)[0];
}

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
 * A separate one-model list for the "Dust & Scratches" workspace — it runs
 * the exact same cleaning prompt as `CLEANING_MODELS` (the backend builds
 * that prompt itself; the model id is all that changes), just always on
 * OpenAI's `gpt-image-1` rather than Gemini. Kept apart from `CLEANING_MODELS`
 * so the Default workspace's model picker (and Chat to Edit's, since it
 * shares that list) is entirely unaffected.
 */
export const GPT_CLEANING_MODELS = [
  {
    id: "gpt-image-1",
    label: "Sparkle GPT Image",
    quality: "high",
    // gpt-image-1's quality is a compute tier, not a resolution — see the
    // note on OPENAI_QUALITIES in backend/src/openai.js. Only the Dust &
    // Scratches workspace offers this model, and that workspace is cleaning,
    // which has no picker, so the list is here for completeness.
    qualities: ["high", "medium", "low"],
    description: "OpenAI's image model · same studio-clean prompt",
    badge: "GPT",
  },
] as const;

export type GptCleaningModelId = (typeof GPT_CLEANING_MODELS)[number]["id"];
export const DEFAULT_GPT_CLEANING_MODEL: GptCleaningModelId = "gpt-image-1";

/**
 * Shared shape a model dropdown expects — built once from a models list
 * rather than in every page. The explicit return type matters: without it,
 * TS widens `entry.id`'s literal union to plain `string`, which is what let
 * a caller's `onModelChange` mismatch its own state setter's type.
 */
export function toModelOptions<
  T extends { id: string; label: string; quality: string; qualities?: readonly string[] },
>(
  models: readonly T[]
): { value: T["id"]; label: string; quality: string; qualities: readonly string[] }[] {
  return models.map((entry) => ({
    value: entry.id,
    label: entry.label,
    quality: entry.quality,
    // Defaulted rather than optional so a consumer can count the options
    // without a null check; a model with one size is a list of one.
    qualities: entry.qualities ?? [entry.quality],
  }));
}

// ── background jobs ─────────────────────────────────────────────────────────

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

/**
 * One queued piece of work. Image tools no longer answer with a finished
 * picture — they answer with one of these, and the result arrives later over
 * the socket (or is found again by `fetchJobs` after a reload).
 */
export type QueuedJob = {
  id: string;
  type: string;
  tool: string;
  status: JobStatus;
  /**
   * 0–100, advanced every second while a run is in flight — not only at
   * phase boundaries. During the provider call it is a prediction, since no
   * provider reports real progress; see `estimatedMs`.
   */
  progress: number;
  /** Which stage the run is in — "preparing", "generating", "saving", "done". Null on older jobs. */
  phase: string | null;
  /**
   * Images this run has already produced, as small inline previews, pushed the
   * moment each one lands rather than when the whole run finishes. Replaced by
   * the stored urls in `result` once the job completes.
   *
   * Live-only, and accumulated by the jobs store across ticks: the server sends
   * each preview on the single tick it arrives, and never re-sends it.
   */
  partials?: string[];
  /** How many of `totalCount` variations have actually come back. The exact figure behind the bar. */
  completedCount?: number;
  totalCount?: number | null;
  /** What this run was predicted to cost, fixed when it started. What "time left" is computed against. */
  estimatedMs: number | null;
  /** What it actually cost. Set once it finishes. */
  durationMs: number | null;
  /**
   * A small thumbnail of the input, so the queue can show which photo is
   * being worked on. Null when the client didn't manage to make one.
   */
  preview: string | null;
  /** What was asked for. Never the images themselves — those stay server-side. */
  request: {
    model?: string;
    modelLabel?: string;
    quality?: string;
    provider?: string;
    isRefinement?: boolean;
    instruction?: string | null;
    customPrompt?: string | null;
    referenceCount?: number;
    conversationId?: string | null;
    /** Text to Image only. */
    prompt?: string | null;
    style?: string | null;
    aspect?: string | null;
    count?: number;
  };
  result: {
    generationId: string | null;
    conversationId: string | null;
    /** Where the finished image is stored. Render this; fetch bytes only to edit further. */
    outputUrl: string | null;
    /** Every variation this run delivered, `outputUrl` repeated as the first entry. */
    outputUrls?: string[];
    /** "video" when the url points at a clip, so a page renders a player rather than an `<img>`. */
    outputType?: "image" | "video";
    durationSeconds?: number;
    /** What a text-out tool produced — Image to Text, and Brand Story. */
    text?: string;
    /** Affinity's parsed catalog copy. */
    result?: { collectionName: string; tagline: string; items: AffinityItem[] };
    /** The saved document a Marketing Kit run wrote, so the page can open it. */
    kitId?: string | null;
    /** The model a Lifestyle model-generation run saved to the library. */
    lifestyleModel?: LifestyleModel;
    model?: string;
    modelLabel?: string;
  } | null;
  error: { message: string; code: string | null } | null;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

/** Answer shape of every route that queues work instead of doing it inline. */
export type QueuedResult = { job?: QueuedJob };

/**
 * The caller's own jobs. Defaults to the live ones, which is the question a
 * freshly-loaded page is really asking: "is anything of mine still running?"
 * This is what makes a reload lossless — nothing is remembered client-side.
 */
export function fetchJobs(params: { status?: string; tool?: string; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  if (params.tool) query.set("tool", params.tool);
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.toString() ? `?${query}` : "";
  return apiRequest<{ jobs?: QueuedJob[]; activeCount?: number }>(`/api/jobs${suffix}`);
}

export function fetchJob(id: string) {
  return apiRequest<{ job?: QueuedJob }>(`/api/jobs/${id}`);
}

/** Only works while a job is still waiting — a started one can't be recalled. */
export function cancelJob(id: string) {
  return apiRequest<{ job?: QueuedJob }>(`/api/jobs/${id}`, { method: "DELETE" });
}

// ── image cleaning calls ────────────────────────────────────────────────────

/**
 * First pass: an uploaded photo in, a queued job out.
 *
 * Answers in milliseconds with a job id rather than waiting out the model, so
 * closing or reloading the tab no longer throws the work away.
 */
export function cleanImage(body: {
  /** Data URI. Compressed in the browser before it gets here. */
  image: string;
  /** A `CLEANING_MODELS` or `GPT_CLEANING_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  /** Replaces the built-in cleaning prompt entirely when given. */
  customPrompt?: string;
  /** Set to keep a retry in the same thread as the run it follows. */
  conversationId?: string | null;
  /** Tiny thumbnail for the queue rail — see `makeThumbnail`. Dropped if oversized. */
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/cleaning", {
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
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  conversationId?: string | null;
  parentGenerationId?: string | null;
}) {
  return apiRequest<ChatEditResult>("/api/chat-to-edit", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── text to image ────────────────────────────────────────────────────────────

/**
 * Kicks off a Text to Image run — a prompt in, a queued job out, same as
 * `cleanImage`. The backend fires `count` variations at the model in
 * parallel and, once they land, the job's `result.outputUrls` carries
 * whichever of them came back.
 */
export function textToImage(body: {
  /** Free text plus whatever the jewelry builder assembled, already joined. */
  prompt: string;
  model: SparkleModelId;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  style: string;
  aspect: string;
  /** How many variations to generate in parallel, e.g. 2/4/6/8. */
  count: number;
}) {
  return apiRequest<QueuedResult>("/api/text-to-image", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** A follow-up on one generated image — also queued, exactly like `refineImage`. */
// ── sketch tools ─────────────────────────────────────────────────────────────

/**
 * The follow-up turn every generate-then-refine tool shares — "make the gold
 * warmer" against a result already produced.
 *
 * Only the endpoint differs, so `refineOn` builds the call for whichever tool
 * is asking. Text to Image and Image Cleaning each used to carry their own
 * byte-identical copy of this.
 *
 * Generic over the model id because the tools don't agree on one: the Sparkle
 * tools accept a `SparkleModelId`, while cleaning also routes GPT models and
 * lets the backend work out which provider an id belongs to.
 */
export type RefineBody<TModel extends string = SparkleModelId> = {
  refineImage: string;
  instruction: string;
  displayPrompt?: string;
  referenceImages?: string[];
  model: TModel;
  /**
   * Output size for this turn. Cleaning's refinements leave it unset — that
   * tool has no picker and always runs at the model's best.
   */
  quality?: string;
  conversationId?: string | null;
  parentGenerationId?: string | null;
  /** Tiny thumbnail for the queue rail — see `makeThumbnail`. Dropped if oversized. */
  preview?: string | null;
};

export function refineOn<TModel extends string = SparkleModelId>(path: string) {
  return (body: RefineBody<TModel>) =>
    apiRequest<QueuedResult>(path, { method: "POST", body: JSON.stringify(body) });
}

/** A follow-up on a Text to Image result. */
export const refineTextToImage = refineOn("/api/text-to-image");

/** A follow-up on a cleaned image. Accepts the GPT model ids too. */
export const refineImage = refineOn<string>("/api/cleaning");

/** A written brief drawn as a sketch, optionally starting from a reference photo. */
export function textToSketch(body: {
  prompt: string;
  model: SparkleModelId;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  style: string;
  aspect: string;
  count: number;
  /** Optional photo the design is drawn from, as a data URI. */
  referenceImage?: string;
}) {
  return apiRequest<QueuedResult>("/api/text-to-sketch", { method: "POST", body: JSON.stringify(body) });
}

/** One or more hand-drawn sketches rendered as a photorealistic product shot. */
export function sketchToImage(body: {
  /** Every view of the piece, as data URIs — they go to the model together. */
  images: string[];
  description?: string;
  model: SparkleModelId;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  count: number;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/sketch-to-image", { method: "POST", body: JSON.stringify(body) });
}

/** A photograph redrawn by hand as a sketch. */
export function imageToSketch(body: {
  image: string;
  style: string;
  model: SparkleModelId;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  count: number;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/image-to-sketch", { method: "POST", body: JSON.stringify(body) });
}

// ── lifestyle ────────────────────────────────────────────────────────────────

/** A saved model photo — the person jewellery gets placed onto. */
export type LifestyleModel = {
  id: string;
  name: string;
  attrs: Record<string, string>;
  notes: string | null;
  imageUrl: string;
  thumbnailUrl: string;
  /** Shared with the whole organization. Only a super admin can set this. */
  isPublic: boolean;
  userName: string;
  createdAt: string;
};

/**
 * The mannequins that ship with the app, for someone who hasn't made a model
 * of their own. The images are served from `public/`, but a run refers to
 * one by number — the backend reads its own copy off disk rather than
 * trusting the browser for what "preset 4" is.
 *
 * The numbers are not positions and are deliberately not renumbered when
 * the list changes: they are what a run records, so renumbering would make
 * an old generation's stored request point at a different person.
 */
export const LIFESTYLE_PRESETS = [
  { number: 4, src: "/lifestyle-presets/model_4.jpg" },
  { number: 5, src: "/lifestyle-presets/model_5.jpg" },
] as const;

export function listLifestyleModels() {
  return apiRequest<{ models?: LifestyleModel[] }>("/api/lifestyle/models");
}

/** Saves a photo the user picked, with no generation behind it. */
export function saveLifestyleModel(body: { name?: string; imageDataUri: string }) {
  return apiRequest<{ model?: LifestyleModel }>("/api/lifestyle/models", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateLifestyleModel(id: string, patch: { name?: string; isPublic?: boolean }) {
  return apiRequest<{ model?: LifestyleModel }>(`/api/lifestyle/models/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteLifestyleModel(id: string) {
  return apiRequest<{ model?: LifestyleModel }>(`/api/lifestyle/models/${id}`, { method: "DELETE" });
}

/** Generates a new model from the builder's attributes. Queued — it's a model call. */
export function generateLifestyleModel(body: {
  attrs: Record<string, string>;
  notes?: string | null;
  name?: string;
  model: SparkleModelId;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
}) {
  return apiRequest<QueuedResult>("/api/lifestyle/model", { method: "POST", body: JSON.stringify(body) });
}

/**
 * Places jewellery onto a model.
 *
 * Exactly one of `modelNumber` (a preset), `modelId` (one from the library)
 * or `modelImage` (a fresh upload) names who wears it.
 */
export function lifestyle(body: {
  modelNumber?: number;
  modelId?: string;
  modelImage?: string;
  /** Every piece to place, as data URIs. More than one is worn as a set. */
  jewelryImages: string[];
  placement: string;
  poseInstruction?: string;
  shotType?: string;
  sceneInstruction?: string;
  description?: string;
  model: SparkleModelId;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/lifestyle", { method: "POST", body: JSON.stringify(body) });
}

/**
 * A follow-up on a lifestyle shot.
 *
 * `jewelryImages` is not the same as `referenceImages`: the originals are
 * re-sent on every turn as the ground truth for the design, so a stone lost
 * on an earlier turn is corrected rather than inherited.
 */
export function refineLifestyle(body: RefineBody & { jewelryImages?: string[] }) {
  return apiRequest<QueuedResult>("/api/lifestyle", { method: "POST", body: JSON.stringify(body) });
}

// ── image to text ────────────────────────────────────────────────────────────

/** Reads one photograph back as the prompt that would recreate it. */
export function imageToText(body: { image: string; preview?: string | null }) {
  return apiRequest<QueuedResult>("/api/image-to-text", { method: "POST", body: JSON.stringify(body) });
}

// ── image to video ───────────────────────────────────────────────────────────

export const VIDEO_MODELS = [
  { id: "veo-3.1-generate-preview", label: "Veo 3.1 Standard", quality: "Best", description: "Highest fidelity · richest motion & detail" },
  { id: "veo-3.1-fast-generate-preview", label: "Veo 3.1 Fast", quality: "Fast", description: "Faster turnaround · strong quality" },
  { id: "veo-3.1-lite-generate-preview", label: "Veo 3.1 Lite", quality: "Budget", description: "Lightweight & economical" },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];
export const DEFAULT_VIDEO_MODEL: VideoModelId = "veo-3.1-fast-generate-preview";

/**
 * Verified live against this account: durations outside 4–8s were rejected
 * as "out of bound" at the time this was tested, so longer values are
 * offered but may still be refused depending on model and tier.
 */
export const VIDEO_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;
export const DEFAULT_VIDEO_DURATION = 8;

/** `w`/`h` draw the shape on the chip, as everywhere else a ratio is picked. */
export const VIDEO_ASPECTS = [
  { id: "16:9", label: "16:9", w: 18, h: 10 },
  { id: "9:16", label: "9:16", w: 9, h: 16 },
] as const;

export const VIDEO_RESOLUTIONS = [
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
] as const;

/**
 * Camera and mood presets. These mirror `backend/src/prompts/video.js` —
 * the ids are the contract, and the backend holds the wording each one
 * actually sends. A preset here that the backend doesn't know falls back to
 * the first one rather than failing the run.
 */
export const VIDEO_CAMERA_STYLES = [
  { id: "orbit", label: "Slow 360° Orbit", description: "One complete turntable revolution — front, side, back, side, home. Loops seamlessly." },
  { id: "push-in", label: "Push-In Reveal", description: "Starts on the full piece, then eases in slightly closer." },
  { id: "pan", label: "Elegant Pan", description: "The camera glides smoothly side to side across the piece." },
  { id: "static", label: "Static Hero Hold", description: "The camera stays still; only light and reflections move." },
  { id: "tilt", label: "Gentle Tilt Reveal", description: "Tilts smoothly from the top to the bottom of the piece." },
  { id: "macro", label: "Macro Sparkle", description: "The only close-up — the lens drifts across the gemstones." },
  { id: "tabletop", label: "Tabletop Reveal", description: "An overhead camera descends slowly from directly above." },
] as const;

export const VIDEO_MOOD_STYLES = [
  { id: "studio", label: "Luxury Studio", description: "Soft, even light on a clean white/grey backdrop." },
  { id: "golden", label: "Golden Hour", description: "Warm, low-angle light on a honey-toned backdrop." },
  { id: "dark", label: "Dark Velvet", description: "Moody rim light on a deep black backdrop." },
  { id: "editorial", label: "Bright Editorial", description: "Crisp light from above on a light backdrop." },
  { id: "lifestyle", label: "Soft Lifestyle", description: "Soft natural window light, warm blurred background." },
  { id: "plain-black", label: "Plain Black", description: "Pure solid black — nothing but the piece in frame." },
  { id: "plain-white", label: "Plain White", description: "Pure seamless white, clean e-commerce look." },
] as const;

/**
 * How many views a clip can be built from. Mirrors MAX_VIEWS in
 * `backend/src/prompts/video.js`.
 */
export const MAX_VIDEO_VIEWS = 6;

/**
 * How many of those Veo will take as visual references — its own hard
 * limit, not ours. The remaining views are still read by the design-spec
 * pass, which has no such cap, so they sharpen the written description the
 * clip is held to rather than being ignored.
 */
export const VIDEO_REFERENCE_VIEWS = 3;

/**
 * The one combination Veo's reference mode accepts — mirrors REFERENCE_MODE
 * in `backend/src/prompts/video.js`, which enforces it. Anything else comes
 * back as an opaque 400 minutes into the queue, so with more than one view
 * the page locks these rather than offering picks that can't be honoured.
 *
 * Notably Fast and Lite do not support reference images at all.
 */
export const VIDEO_REFERENCE_MODE = {
  model: "veo-3.1-generate-preview" as VideoModelId,
  aspectRatio: "16:9",
  resolution: "720p",
  durationSeconds: 8,
} as const;

/**
 * Animates a piece from one to three views of it. Minutes rather than
 * seconds — it runs on its own queue lane.
 *
 * One view is a first frame: the clip opens on that exact photo. Two or
 * three go in as references instead, which is what lets an orbit show the
 * real back of the piece — at the cost of the opening frame, which Veo then
 * composes itself.
 */
export function imageToVideo(body: {
  images: string[];
  /**
   * What angle each image is — "Front", "Side", "Back", "Top" — parallel to
   * `images`. Read by the analysis pass, which describes the piece better
   * when it knows which photograph is the back, and cannot judge symmetry at
   * all without knowing which side it is looking at.
   */
  viewLabels?: string[];
  description?: string;
  model: VideoModelId;
  camera: string;
  mood: string;
  aspectRatio: string;
  resolution: string;
  durationSeconds: number;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/image-to-video", { method: "POST", body: JSON.stringify(body) });
}

// ── marketing kit ────────────────────────────────────────────────────────────

export type MarketingKitKind = "brand_story" | "affinity" | "campaign";

/** One entry in the saved-kits rail. Summaries only — a full kit is large. */
export type MarketingKitSummary = {
  id: string;
  kind: MarketingKitKind;
  title: string;
  /**
   * `failed` means the run produced something but storing it didn't — the
   * row exists so the attempt is visible rather than vanishing, and `error`
   * says why.
   */
  status: "draft" | "ready" | "failed";
  error: string | null;
  previewUrl: string | null;
  pieceCount: number;
  userName: string;
  /** Absent outside a listing; only the owner may edit or delete a kit. */
  isOwn?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MarketingKitImage = {
  id: string;
  url: string;
  /** The grid-sized copy. Falls back to `url` server-side, so never empty. */
  thumbnailUrl: string;
  role: "product" | "sheet" | "model";
  width: number | null;
  height: number | null;
  fileName: string | null;
  pdfName: string | null;
  pdfPage: number | null;
};

export type AffinityItem = {
  index: number;
  category: string;
  /** Empty for a New Ideation piece — one with no production sheet to verify against. */
  title: string;
  caption: string;
  sourceCode: string | null;
  size: "sm" | "md" | "lg";
  width?: number;
  height?: number;
  notes?: { id: string; text: string; x: number; y: number }[];
};

export type MarketingKit = MarketingKitSummary & {
  model: { provider: string; modelId: string; modelLabel: string | null };
  generationId: string | null;
  brandStory: {
    images: MarketingKitImage[];
    sheetImages: MarketingKitImage[];
    analysis: string;
    /** What the model first wrote. Never edited, so AI copy stays distinguishable. */
    originalAnalysis: string;
  } | null;
  affinity: {
    collectionName: string;
    tagline: string;
    coverSplit: number;
    items: AffinityItem[];
    originalItems: AffinityItem[];
    pieces: {
      index: number;
      productImage: MarketingKitImage | null;
      sheetImages: MarketingKitImage[];
      sheetExcelCount: number;
      designerInitial: string;
      hasProductionSheet: boolean;
    }[];
  } | null;
  campaign: {
    modelImage: MarketingKitImage | null;
    sourceImages: MarketingKitImage[];
    shots: CampaignShot[];
    /** As generated. Never edited, so AI output stays distinguishable. */
    originalShots: CampaignShot[];
    options: Record<string, unknown>;
  } | null;
};

/** One of a Campaign Kit's four shots. Points at an Asset, not its own copy. */
export type CampaignShot = {
  id: "lifestyleWarm" | "lifestyleDramatic" | "studioClean" | "studioLuxury";
  label: string;
  assetId: string | null;
  url: string;
  thumbnailUrl: string | null;
  /** The only editable field — the rest is what the run produced. */
  caption: string;
};

/** Several photos of one piece, read as a design narrative. */
export function brandStory(body: { images: string[]; sheetImages?: string[]; preview?: string | null }) {
  return apiRequest<QueuedResult>("/api/marketing-kit/brand-story", { method: "POST", body: JSON.stringify(body) });
}

/**
 * Several pieces turned into catalog copy.
 *
 * Workbooks are parsed to text in the browser — `sheetExcelText` is that
 * text. Keeping the parser client-side is what stops the backend carrying a
 * spreadsheet library for one tool.
 */
export function affinity(body: {
  items: { image: string; sheetImages?: string[]; sheetExcelText?: string[] }[];
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/marketing-kit/affinity", { method: "POST", body: JSON.stringify(body) });
}

/** Four shots in one run — two of the piece worn, two of it alone. */
export function campaignKit(body: {
  modelNumber?: number;
  modelId?: string;
  modelImage?: string;
  jewelryImages: string[];
  description?: string;
  /** Up to two picks each — one per shot in the pair. */
  boxStyles?: string[];
  poses?: string[];
  studioProps?: string[];
  aspect: string;
  model: SparkleModelId;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/marketing-kit/campaign", { method: "POST", body: JSON.stringify(body) });
}

/** Retouching one shot of a kit. `shotLabel` tells the backend whether a person is in it. */
export const refineCampaignKit = (body: RefineBody & { shotLabel?: string }) =>
  apiRequest<QueuedResult>("/api/marketing-kit/campaign", { method: "POST", body: JSON.stringify(body) });

export function listMarketingKits(
  params: { kind?: MarketingKitKind; cursor?: string; limit?: number; scope?: "own" | "team" } = {}
) {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.scope) query.set("scope", params.scope);
  const qs = query.toString();
  return apiRequest<{ kits: MarketingKitSummary[]; nextCursor: string | null }>(
    `/api/marketing-kit/kits${qs ? `?${qs}` : ""}`
  );
}

export function fetchMarketingKit(id: string) {
  return apiRequest<{ kit?: MarketingKit }>(`/api/marketing-kit/kits/${id}`);
}

/**
 * Applies an edit to a saved kit. Only the fields a person may change —
 * the uploads and the `original*` fields are deliberately not updatable.
 */
export function updateMarketingKit(
  id: string,
  changes: {
    title?: string;
    analysis?: string;
    collectionName?: string;
    tagline?: string;
    coverSplit?: number;
    items?: AffinityItem[];
    /** Captions only — a shot's id, label and url are not the client's to change. */
    shots?: { id: string; caption: string }[];
  }
) {
  return apiRequest<{ kit?: MarketingKit }>(`/api/marketing-kit/kits/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

export function deleteMarketingKit(id: string) {
  return apiRequest<{ deleted?: boolean }>(`/api/marketing-kit/kits/${id}`, { method: "DELETE" });
}

// ── spelling ─────────────────────────────────────────────────────────────────

/** One misspelling, as character offsets into the text that was checked. */
export type SpellIssue = {
  from: number;
  to: number;
  word: string;
  /** Ranked corrections, best first — jewellery terms ahead of general English. */
  suggestions: string[];
};

/**
 * Checks a prompt against English (US and British) plus this organisation's
 * jewellery lexicon. Called on a typing pause, never per keystroke — the
 * dictionaries live on the server.
 */
export function checkSpelling(text: string) {
  return apiRequest<{ issues?: SpellIssue[] }>("/api/lexicon/check", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** "Add to dictionary" — teaches one word to the whole organisation. */
export function addLexiconTerm(term: string) {
  return apiRequest<{ term?: string }>("/api/lexicon", {
    method: "POST",
    body: JSON.stringify({ term }),
  });
}

// ── history ──────────────────────────────────────────────────────────────────

export type HistoryOutput = {
  assetId: string;
  /** Full-size original. What a download, a lightbox, or resuming the conversation must use. */
  url: string;
  /**
   * Small copy for grid tiles. Falls back to `url` server-side for an image,
   * so it is never empty for one — but it is null for a video with no poster
   * frame, because a browser cannot render an mp4 in an `<img>` and falling
   * back there would give a broken tile rather than a heavy one.
   */
  thumbnailUrl: string | null;
  /** What to render this as. "image" on every row written before video existed. */
  type: "image" | "video";
  durationMs: number | null;
  width: number | null;
  height: number | null;
};

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
  /** What a text-out tool produced. Null for every tool that makes pictures. */
  text?: string | null;
  /**
   * The Marketing Kit this run wrote, where it wrote one — so History can
   * open the deck rather than show the model's raw JSON, which is what an
   * Affinity run's stored text actually is.
   */
  kitId?: string | null;
};

export type ConversationAsset = { url: string; thumbnailUrl: string; role: string };
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
 * page.
 *
 * Every filter is applied by the server, so a page is a page of results the
 * caller asked for. Filtering in the browser instead meant the cursor walked
 * the unfiltered collection: narrowing to one teammate searched only the rows
 * already fetched, and an empty grid never scrolled far enough to ask for
 * more — so matching work sat unfetched and unreachable.
 */
export function fetchHistory(
  params: {
    /** Any of these tools. Empty or omitted means every tool. */
    tools?: string[];
    /** Any of these people, by the name recorded on the run. */
    members?: string[];
    /** Any of these resolutions, as the tile's badge shows them — "1K", "2K", "4K". */
    qualities?: string[];
    /** What the run produced: "image", "video", or "text" for a text-only answer. */
    types?: string[];
    /** Inclusive range over `createdAt`. A bare `to` date covers its whole day. */
    from?: string;
    to?: string;
    before?: string;
    limit?: number;
    scope?: "own" | "team";
  } = {}
) {
  const query = new URLSearchParams();
  params.tools?.forEach((value) => query.append("tool", value));
  params.members?.forEach((value) => query.append("member", value));
  params.qualities?.forEach((value) => query.append("quality", value));
  params.types?.forEach((value) => query.append("type", value));
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  if (params.before) query.set("before", params.before);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.scope === "team") query.set("scope", "team");
  const qs = query.toString();
  return apiRequest<{ items: HistoryItem[]; nextCursor: string | null; canReadTeam: boolean }>(
    `/api/history${qs ? `?${qs}` : ""}`
  );
}

/**
 * Who and what the History filters can offer, across everything in reach —
 * not just the rows paged in so far, which is what the page used to derive
 * its member list from.
 */
export function fetchHistoryFacets(scope: "own" | "team" = "team") {
  return apiRequest<{ members: string[]; tools: string[]; qualities: string[] }>(
    `/api/history/facets${scope === "team" ? "?scope=team" : ""}`
  );
}

/** Permanently removes one generation (and its images) from history. */
// ── credits ─────────────────────────────────────────────────────────────────

export type CreditBalance = {
  /** Owned, including what is frozen. */
  balance: number;
  /** Frozen by runs in flight. */
  reserved: number;
  /** Spendable right now — the figure a run is checked against. */
  available: number;
};

export type CreditEntry = {
  id: string;
  kind: "grant" | "revoke" | "transfer_in" | "transfer_out" | "hold" | "settle" | "refund" | "adjust";
  amount: number;
  held: number;
  tool: string | null;
  modelId: string | null;
  quality: string | null;
  unit: string | null;
  unitPrice: number | null;
  units: number | null;
  jobId: string | null;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
  holder?: string;
};

export type CreditTenantSummary = {
  id: string;
  name: string;
  slug: string;
  status: string;
  pool: { id: string | null; balance: number; reserved: number; available: number } | null;
  totalBalance: number;
  totalReserved: number;
  memberCount: number;
};

export type CreditMember = {
  userId: string;
  name: string;
  email: string;
  status: string;
  role: string;
  /** True for the signed-in reader, whose row is sorted to the top. */
  isSelf?: boolean;
  balance: number;
  reserved: number;
  available: number;
  lifetimeSpent: number;
};

/** The signed-in person's own balance. Needs no permission beyond being logged in. */
export function fetchMyCredits() {
  return apiRequest<{ credits: CreditBalance }>("/api/credits/me");
}

/**
 * The signed-in admin's own organization — pool, members, and whether they
 * may share credits out. Takes no id: an admin sees their own organization
 * and there is no way to ask for another.
 */
export function fetchMyOrgCredits() {
  return apiRequest<{
    tenant: { id: string; name: string; slug: string; status: string };
    pool: { id: string | null; balance: number; reserved: number; available: number };
    canManage: boolean;
    members: CreditMember[];
  }>("/api/credits/my");
}

/**
 * An org admin's own colleagues, plus the grant catalogue and the subset of
 * it this admin may hand out — they can only pass on what they hold.
 */
export function fetchOrgMembers() {
  return apiRequest<{
    groups: GrantGroup[];
    assignableGrants: string[];
    selfId: string;
    members: Member[];
  }>("/api/org/members");
}

/** Updates one colleague. Refused server-side for your own row, or for a grant you lack. */
export function updateOrgMember(id: string, patch: Parameters<typeof updateMember>[1]) {
  return apiRequest<{ member: Member }>(`/api/org/members/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** Moves credits from the organization pool to one of its members. */
export function distributeCredits(body: { userId: string; amount: number; reason?: string }) {
  return apiRequest("/api/credits/distribute", { method: "POST", body: JSON.stringify(body) });
}

/** Pulls a member's unspent credits back into the pool. */
export function reclaimCredits(body: { userId: string; amount: number; reason?: string }) {
  return apiRequest("/api/credits/reclaim", { method: "POST", body: JSON.stringify(body) });
}

export function fetchCreditTenants() {
  return apiRequest<{ tenants: CreditTenantSummary[] }>("/api/credits/tenants");
}

export function fetchCreditTenant(id: string) {
  return apiRequest<{
    tenant: { id: string; name: string; slug: string; status: string };
    pool: { id: string | null; balance: number; reserved: number; available: number };
    members: CreditMember[];
  }>(`/api/credits/tenants/${id}`);
}

export function fetchCreditLedger(tenantId: string, limit = 100) {
  return apiRequest<{ entries: CreditEntry[] }>(`/api/credits/tenants/${tenantId}/ledger?limit=${limit}`);
}

/** Who granted, revoked, shared out or took back — the decisions behind the ledger. */
export type CreditAuditEntry = {
  id: string;
  action: string;
  status: string;
  actorName?: string;
  message?: string;
  amount: number | null;
  createdAt: string;
};

export function fetchCreditAudit(tenantId: string, limit = 100) {
  return apiRequest<{ entries: CreditAuditEntry[] }>(`/api/credits/tenants/${tenantId}/audit?limit=${limit}`);
}

/** `userId: null` grants to the organization pool instead of a person. */
export function grantCredits(body: { tenantId: string; userId?: string | null; amount: number; reason?: string }) {
  return apiRequest("/api/credits/grant", { method: "POST", body: JSON.stringify(body) });
}

export function revokeCredits(body: { tenantId: string; userId?: string | null; amount: number; reason?: string }) {
  return apiRequest("/api/credits/revoke", { method: "POST", body: JSON.stringify(body) });
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
