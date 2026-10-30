import type { DeckCategory } from "./affinity";

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
  /** IANA zone that decides when a new day starts for daily credit allowances. */
  timezone: string;
  aiProviderCount: number;
  memberCount: number;
  /** How many members carry the admin label. */
  adminCount: number;
  /** The pool plus every member's balance, with what runs in flight have frozen. */
  credits: {
    balance: number;
    reserved: number;
    available: number;
    pool: number;
    /** The pool less what is frozen — what the organization's Credits page calls "Available". */
    poolAvailable: number;
    /** Net of every super-admin grant and revoke — what the organization has been given. */
    given: number;
  };
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
  credits: { balance: number; reserved: number; available: number; dailyAllowance?: number | null };
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

export function updateOrganization(id: string, patch: { name?: string; status?: string; timezone?: string }) {
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
    provider: "Gemini",
    quality: "4K",
    qualities: ["4K", "2K", "1K"],
    description: "Highest fidelity · complex detail",
    badge: "Best quality",
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Sparkle 3.1 Flash Image",
    provider: "Gemini",
    quality: "4K",
    qualities: ["4K", "2K", "1K"],
    description: "Optimised for speed · high volume",
    badge: "Fast",
  },
] as const;

/**
 * New Cleaning's models — OpenRouter's GPT image models instead of Gemini.
 * Kept separate from `CLEANING_MODELS` since Default keeps its Gemini list
 * unchanged; only New Cleaning routes through OpenRouter. Ids match
 * `OPENROUTER_MODELS` in backend/src/openrouter.js.
 */
export const NEW_CLEANING_MODELS = [
  {
    id: "openai/gpt-image-2",
    label: "Sparkle GPT Image 2",
    provider: "OpenRouter",
    quality: "high",
    qualities: ["high", "medium", "low"],
    description: "OpenAI's latest image model · via OpenRouter",
    badge: "Best quality",
  },
  {
    id: "openai/gpt-image-1",
    label: "Sparkle GPT Image",
    provider: "OpenRouter",
    quality: "high",
    qualities: ["high", "medium", "low"],
    description: "OpenAI's prior image model · via OpenRouter",
    badge: "Fast",
  },
] as const;

export type NewCleaningModelId = (typeof NEW_CLEANING_MODELS)[number]["id"];
export const DEFAULT_NEW_CLEANING_MODEL: NewCleaningModelId = "openai/gpt-image-2";

/**
 * Cleaning in Testing — photo editors from other makers, on trial against the
 * standard cleaning instructions, all through OpenRouter. Mirrors the backend's
 * EDIT_STYLE_MODELS (and the two GPT Image 2.5 tiers) in providers/openrouter.
 *
 * Labels must match the backend's: a result is reopened on the testing page
 * by its model's name (see lib/nav.ts workspacePathFor). None of these appear
 * on another cleaning page, which is what makes that unambiguous.
 */
const EDIT_TIERS = ["2K", "1K"] as const;
/** The one trial model that renders 4K — see the backend's EDIT_4K_MODELS. */
const EDIT_4K_TIERS = ["4K", "2K", "1K"] as const;
const GPT_TIERS = ["high", "medium", "low"] as const;
export const TESTING_CLEANING_MODELS = [
  { id: "google/gemini-nano-banana-2.1", label: "Nano Banana 2.1", provider: "Google", quality: "4K", qualities: EDIT_4K_TIERS, description: "Most faithful retouch · most consistent gold · 4K", badge: "Recommended" },
  { id: "openai/gpt-image-2.5-sunburst", label: "GPT Image 2.5 Sunburst", provider: "OpenAI", quality: "high", qualities: GPT_TIERS, description: "Precision tier of GPT Image 2.5" },
  { id: "openai/gpt-image-2.5-flare", label: "GPT Image 2.5 Flare", provider: "OpenAI", quality: "high", qualities: GPT_TIERS, description: "Brightest gold · may redraw small details · up to 1.2K", badge: "Backup" },
  { id: "black-forest-labs/flux-3-image", label: "FLUX 3 Image", provider: "Black Forest Labs", quality: "2K", qualities: EDIT_TIERS, description: "Flagship editor · multi-reference" },
  { id: "black-forest-labs/flux.2-max", label: "FLUX.2 Max", provider: "Black Forest Labs", quality: "2K", qualities: EDIT_TIERS, description: "Top FLUX.2 tier · consistent edits" },
  { id: "bytedance-seed/seedream-5-0-pro", label: "Seedream 5.0 Pro", provider: "ByteDance", quality: "2K", qualities: EDIT_TIERS, description: "Precise editing for commercial product work" },
  { id: "qwen/qwen-image-3-pro", label: "Qwen Image 3 Pro", provider: "Qwen", quality: "2K", qualities: EDIT_TIERS, description: "Holds details as small as 10px" },
  { id: "krea/k3-edit", label: "Krea K3 Edit", provider: "Krea", quality: "2K", qualities: EDIT_TIERS, description: "Image-to-image editor · follows instructions closely" },
  { id: "microsoft/mai-image-2.6", label: "MAI-Image-2.6", provider: "Microsoft", quality: "2K", qualities: EDIT_TIERS, description: "Precision tier of MAI-Image" },
  { id: "x-ai/grok-imagine-image-2.0", label: "Grok Imagine Image 2.0", provider: "xAI", quality: "2K", qualities: EDIT_TIERS, description: "Edits from references" },
  { id: "sourceful/riverflow-v2.5-pro", label: "Riverflow V2.5 Pro", provider: "Sourceful", quality: "2K", qualities: EDIT_TIERS, description: "Built for product imagery · top control" },
  { id: "tencent/hy-image-v3.5-preview", label: "Hy Image 3.5", provider: "Tencent", quality: "2K", qualities: EDIT_TIERS, description: "Preview · multi-turn editing" },
  { id: "meta/muse-image", label: "Muse Image", provider: "Meta", quality: "2K", qualities: EDIT_TIERS, description: "Reasons before it renders" },
] as const;

export type TestingCleaningModelId = (typeof TESTING_CLEANING_MODELS)[number]["id"];

/**
 * What the testing page actually offers: only the badged models — the ones
 * that kept the design intact, the white metal white and the gold consistent
 * across a benchmark set with the studio prompt. Nano Banana 2.1 led on all
 * three and is the only one that renders 4K; Flare is the backup for when it
 * is unavailable. The full list above stays, so a run made on a retired
 * model still reopens on this page (lib/nav.ts) and falls back to these.
 */
type OfferedTestingCleaningModel = Extract<(typeof TESTING_CLEANING_MODELS)[number], { badge: string }>;
export const OFFERED_TESTING_CLEANING_MODELS = TESTING_CLEANING_MODELS.filter(
  (model): model is OfferedTestingCleaningModel => "badge" in model
);
export const DEFAULT_TESTING_CLEANING_MODEL: OfferedTestingCleaningModel["id"] = "google/gemini-nano-banana-2.1";

/**
 * Lifestyle's models — only the three that held up in a side-by-side test on
 * real pieces (a thin bamboo ring, a letter pendant, halo studs, a pavé
 * bangle): the exact design, true-to-life size, a close crop that shows it,
 * nothing else on the model. Sparkle 3.1 Flash passed every case too, just
 * with stones a little less crisp than 3 Pro's, so it is the fast option. Of
 * the rest, GPT Image 2 and 2.5 framed rings as portraits with the ring too
 * small to read (and reject Lifestyle's default 4:5 frame, as Grok does);
 * Grok redrew the ring as a wide band; FLUX shot full-length; GPT Image 1
 * replaced the designs. Its own list, so the tools sharing IMAGE_EDIT_MODELS
 * keep theirs.
 */
export const LIFESTYLE_MODELS = [
  {
    id: "gemini-3-pro-image",
    label: "Sparkle 3 Pro Image",
    provider: "Gemini",
    quality: "4K",
    qualities: ["4K", "2K", "1K"],
    description: "Finest detail · 4K",
    badge: "Best quality",
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Sparkle 3.1 Flash Image",
    provider: "Gemini",
    quality: "4K",
    qualities: ["4K", "2K", "1K"],
    description: "Faster · slightly softer stones · 4K",
    badge: "Fast",
  },
  {
    id: "bytedance-seed/seedream-5-0-pro",
    label: "Seedream 5.0 Pro",
    provider: "ByteDance",
    quality: "2K",
    qualities: EDIT_TIERS,
    description: "Natural look, true to size · 2K",
    badge: "Most natural",
  },
] as const;
export type LifestyleModelId = (typeof LIFESTYLE_MODELS)[number]["id"];
export const DEFAULT_LIFESTYLE_MODEL: LifestyleModelId = "gemini-3-pro-image";

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
  // Searches every extra-model list, not just `CLEANING_MODELS`: each adds ids
  // the others don't have (`gpt-image-1` native OpenAI vs. `gpt-image-2` via
  // OpenRouter, Seedream for Lifestyle), so a lookup that checked one would
  // miss the rest.
  return (
    IMAGE_EDIT_MODELS.find((m) => m.id === modelId)?.qualities ??
    OPTIONAL_IMAGE_MODELS.find((m) => m.id === modelId)?.qualities ??
    TESTING_CLEANING_MODELS.find((m) => m.id === modelId)?.qualities ??
    LIFESTYLE_MODELS.find((m) => m.id === modelId)?.qualities ??
    ["1K"]
  );
}

/** The size a freshly-picked model starts on — its best. */
export function defaultQualityFor(modelId: string): string {
  return qualitiesFor(modelId)[0];
}

export type CleaningModelId = (typeof CLEANING_MODELS)[number]["id"];

/**
 * Text models — picked by the tool, never by the user, so they appear in no
 * picker. Listed here only so their Sparkle name shows wherever a run made
 * with one is displayed (History, Image to Text, Marketing Kit).
 */
const TEXT_MODEL_LABELS: Record<string, string> = {
  "gemini-2.5-pro": "Sparkle 2.5 Pro",
  "gemini-2.5-flash": "Sparkle 2.5 Flash",
  "google/gemini-2.5-pro": "Sparkle 2.5 Pro",
  "google/gemini-2.5-flash": "Sparkle 2.5 Flash",
};

/**
 * Model id → Sparkle label, for a history row from before the backend
 * recorded the label itself — or recorded the raw id as its label, as text
 * runs did until they had Sparkle names.
 */
export const MODEL_LABELS: Record<string, string> = {
  ...TEXT_MODEL_LABELS,
  ...Object.fromEntries(CLEANING_MODELS.map((m) => [m.id, m.label])),
};

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
 * The model list for every tool that always hands the model at least one
 * input photo — Chat to Edit, Sketch to Image, Image to Sketch, Lifestyle,
 * Campaign Kit. The Gemini models plus OpenAI's, routed through OpenAI
 * directly (not via OpenRouter, unlike New Cleaning's GPT options) since the
 * backend's own `openai` provider module already exists and only needs an
 * image to edit, which every one of these tools always has.
 *
 * Deliberately not folded into `SPARKLE_MODELS`: native OpenAI (`gpt-image-1`
 * called directly, not via OpenRouter) only exposes an edit endpoint, so a
 * tool with no guaranteed input photo can't use it. Text to Image and Text to
 * Sketch still get a GPT option — see `OPTIONAL_IMAGE_MODELS` below — just
 * OpenRouter's `gpt-image-2`, which (unlike native OpenAI) has a real
 * text-only mode as well as an edit one.
 */
export const IMAGE_EDIT_MODELS = [
  {
    id: "gpt-image-1",
    label: "Sparkle GPT Image",
    provider: "OpenAI",
    quality: "high",
    qualities: ["high", "medium", "low"],
    description: "OpenAI's image model",
    badge: "Alternate",
  },
  ...CLEANING_MODELS,
] as const;
export type ImageEditModelId = (typeof IMAGE_EDIT_MODELS)[number]["id"];
export const DEFAULT_IMAGE_EDIT_MODEL: ImageEditModelId = DEFAULT_CLEANING_MODEL;

/**
 * The model list for tools whose input photo is optional or absent — Text to
 * Image (never has one) and Text to Sketch (an optional reference). The
 * Gemini models plus OpenRouter's `gpt-image-2`. Unlike `IMAGE_EDIT_MODELS`'s
 * OpenAI option, this one has to go through OpenRouter rather than native
 * OpenAI: native OpenAI's `images.edit` always requires an image, but
 * OpenRouter's `images/generations` endpoint has a genuine text-only mode
 * too (confirmed against its own Playground export — no `input_references`
 * field at all when there's no image to send, and the field present when
 * there is one), so it can serve either of these tools whether or not a
 * photo came along.
 */
export const OPTIONAL_IMAGE_MODELS = [
  {
    id: "openai/gpt-image-2",
    label: "Sparkle GPT Image 2",
    // Shown as "OpenAI" like every other GPT option in the app, even though
    // this one happens to be routed through OpenRouter under the hood — the
    // picker groups by who made the model, not by which pipe reaches it.
    provider: "OpenAI",
    quality: "high",
    qualities: ["high", "medium", "low"],
    description: "OpenAI's latest image model · via OpenRouter",
    badge: "Alternate",
  },
  ...CLEANING_MODELS,
] as const;
export type OptionalImageModelId = (typeof OPTIONAL_IMAGE_MODELS)[number]["id"];
export const DEFAULT_OPTIONAL_IMAGE_MODEL: OptionalImageModelId = DEFAULT_CLEANING_MODEL;

/**
 * Shared shape a model dropdown expects — built once from a models list
 * rather than in every page. The explicit return type matters: without it,
 * TS widens `entry.id`'s literal union to plain `string`, which is what let
 * a caller's `onModelChange` mismatch its own state setter's type.
 */
export function toModelOptions<
  T extends { id: string; label: string; quality: string; qualities?: readonly string[]; provider?: string },
>(
  models: readonly T[]
): { value: T["id"]; label: string; quality: string; qualities: readonly string[]; provider?: string }[] {
  return models.map((entry) => ({
    value: entry.id,
    label: entry.label,
    quality: entry.quality,
    // Defaulted rather than optional so a consumer can count the options
    // without a null check; a model with one size is a list of one.
    qualities: entry.qualities ?? [entry.quality],
    provider: entry.provider,
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
    /** A tool's sub-mode with a page of its own — Image Cleaning's "product_views". */
    mode?: string | null;
  };
  result: {
    generationId: string | null;
    conversationId: string | null;
    /** Where the finished image is stored. Render this; fetch bytes only to edit further. */
    outputUrl: string | null;
    /** Every variation this run delivered, `outputUrl` repeated as the first entry. */
    outputUrls?: string[];
    /** How a follow-up was read — "Metal → rose gold". Null for a plain edit or a first run. */
    intentLabel?: string | null;
    /** Product Views: the angle each of `outputUrls` shows, index for index. */
    views?: string[];
    /** "video" when the url points at a clip, so a page renders a player rather than an `<img>`. */
    outputType?: "image" | "video";
    durationSeconds?: number;
    /** What a text-out tool produced — Image to Text, and Brand Story. */
    text?: string;
    /** Affinity's parsed catalog copy. */
    result?: { collectionName: string; tagline: string; items: AffinityItem[]; categories?: DeckCategory[] };
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
  /** A `CLEANING_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  /** Replaces the built-in cleaning prompt entirely when given. */
  customPrompt?: string;
  /**
   * Which built-in prompt a plain "Clean this image" resolves to, one per
   * cleaning mode's page ("studio" is Cleaning in Testing's). Ignored once
   * `customPrompt` is set, and irrelevant to a refinement, which never reads
   * either.
   */
  variant?: "default" | "new" | "shank" | "studio";
  /**
   * What the user also wants in the image, added on top of the built-in
   * prompt (unlike `customPrompt`, which replaces it). Ignored with `customPrompt`.
   */
  extraNotes?: string;
  /**
   * Take every engraving, hallmark and brand stamp off the piece. Only read
   * alongside the built-in prompt; left out, they are kept.
   */
  removeMarkings?: boolean;
  /** Set to keep a retry in the same thread as the run it follows. */
  conversationId?: string | null;
  /** Tiny thumbnail for the queue rail — see `makeThumbnail`. Dropped if oversized. */
  preview?: string | null;
  /** sha256 of the original file, so a later re-upload of it can be recognised. */
  sourceChecksum?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/cleaning", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** An earlier cleaning of the same photo, somewhere in the organization. */
export type CleaningDuplicate = {
  /** How many times it has been cleaned. */
  times: number;
  /** Everyone who has cleaned it, most recent first. */
  people: string[];
  latest: {
    userName: string;
    isOwn: boolean;
    createdAt: string;
    /** Decides which cleaning page reopens it. */
    modelLabel: string | null;
    /** Null when this reader may not open that chat. */
    conversationId: string | null;
  };
};

/**
 * Which of these photos have been cleaned before, by anyone in the
 * organization. Keyed by the `id` each check was sent with; a photo with no
 * earlier cleaning is simply absent.
 */
export function checkCleaningDuplicates(checks: { id: string; sourceChecksum: string; checksum: string }[]) {
  return apiRequest<{ matches: Record<string, CleaningDuplicate> }>("/api/cleaning/duplicates", {
    method: "POST",
    body: JSON.stringify({ checks }),
  });
}

// ── chat to edit ─────────────────────────────────────────────────────────────

export type ChatEditResult = {
  /** The results as data URIs — one for an edit, several for "more designs". */
  images?: string[];
  model?: string;
  conversationId?: string | null;
  generationId?: string | null;
  /** How the instruction was read — "Metal → rose gold". Null for a plain edit. */
  intentLabel?: string | null;
};

/**
 * What an attached image is for in Chat to Edit — see REFERENCE_ROLES in
 * backend/src/prompts/chatToEdit.js. "marks" is set by the page for a
 * marked-up copy of the photo, never picked by hand.
 */
export type ReferenceRole = "auto" | "piece" | "stone" | "texture" | "scene" | "inspiration" | "marks";

/** The roles a person can pick for an attachment, in menu order. */
export const REFERENCE_ROLE_OPTIONS: { value: ReferenceRole; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Decided from your message" },
  { value: "piece", label: "New piece", hint: "Put this jewellery in — replacing the one in the photo" },
  { value: "stone", label: "Stone", hint: "Set this stone into the jewellery — any shape" },
  { value: "texture", label: "Texture", hint: "Give the metal this surface or finish" },
  { value: "scene", label: "Wear on", hint: "A hand or model photo to wear the piece" },
  { value: "inspiration", label: "Idea", hint: "Borrow an idea — never copied" },
];

/**
 * One turn of a chat-style edit. Unlike cleaning there's no "default" prompt
 * mode — `instruction` always drives the edit, so it's required.
 */
export function chatEdit(body: {
  /** The image being edited this turn, as a data URI. */
  image: string;
  /** Extra images, each used as its `referenceRoles` entry says. */
  referenceImages?: string[];
  /** One per reference image, in the same order. Missing means "auto". */
  referenceRoles?: ReferenceRole[];
  /** What's actually sent to the model. */
  instruction: string;
  /** What the UI shows for this turn. Falls back to `instruction` server-side if omitted. */
  displayPrompt?: string;
  /** An `IMAGE_EDIT_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
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
  /** An `OPTIONAL_IMAGE_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  style: string;
  aspect: string;
  /** How many variations to generate in parallel, e.g. 2/4/6/8. */
  count: number;
  /** Optional photos to start the design from, as data URIs (up to 4). */
  referenceImage?: string[];
  /** Current trends to follow, one per image in turn — see `JewelryTrend`. */
  trends?: TrendCue[];
  /** With a reference photo: each image a new design option grown from it, not a recreation. */
  designVariations?: boolean;
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
  /**
   * `refineImage` has the user's marks drawn on it. The model is then told
   * the marks show where to change, and must not appear in the result.
   */
  annotated?: boolean;
  /** Whether `refineImage` is a generated result or the user's own input — see `RefineRequest`. */
  refineSource?: "result" | "input";
};

export function refineOn<TModel extends string = SparkleModelId>(path: string) {
  return (body: RefineBody<TModel>) =>
    apiRequest<QueuedResult>(path, { method: "POST", body: JSON.stringify(body) });
}

/** A follow-up on a Text to Image result. */
export const refineTextToImage = refineOn<string>("/api/text-to-image");

/** A follow-up on a cleaned image. Accepts the GPT model ids too. */
export const refineImage = refineOn<string>("/api/cleaning");

/** A written brief drawn as a sketch, optionally starting from a reference photo. */
export function textToSketch(body: {
  prompt: string;
  /** An `OPTIONAL_IMAGE_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  style: string;
  aspect: string;
  count: number;
  /** Optional photos the design is drawn from, as data URIs (up to 4). */
  referenceImage?: string[];
  /** Current trends to follow, one per sketch in turn — see `JewelryTrend`. */
  trends?: TrendCue[];
  /** With a reference photo: each sketch a new design option grown from it, not a redraw. */
  designVariations?: boolean;
}) {
  return apiRequest<QueuedResult>("/api/text-to-sketch", { method: "POST", body: JSON.stringify(body) });
}

/** One or more hand-drawn sketches rendered as a photorealistic product shot. */
export function sketchToImage(body: {
  /** Every view of the piece, as data URIs — they go to the model together. */
  images: string[];
  description?: string;
  /** An `IMAGE_EDIT_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  count: number;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/sketch-to-image", { method: "POST", body: JSON.stringify(body) });
}

/** A standard catalogue angle Product Views covers. */
/** Kinds of piece — each is showcased from its own set of angles. */
export type ProductViewCategory = "ring" | "earrings" | "pendant";

export type ProductViewId =
  | "three-quarter"
  | "front"
  | "side"
  | "upright"
  | "earring-pair"
  | "earring-front-side"
  | "pendant-front"
  | "pendant-side";

/** Product Views: the angles without a photo, one image each. */
export function generateProductViews(body: {
  category: ProductViewCategory;
  /** The photos the person placed, each with the angle it was placed as. */
  photos: { view: ProductViewId; image: string }[];
  views: ProductViewId[];
  notes?: string;
  model: string;
  quality?: string;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/product-views", { method: "POST", body: JSON.stringify(body) });
}

/** Replacement: what is being worn in the photo — each is fitted and sized against its own part of the body. */
export type ReplacementCategory = "ring" | "earrings" | "necklace" | "bracelet";

/** Replacement's size presets, for a person who would rather pick than type millimetres. */
export type ReplacementSize = "delicate" | "classic" | "statement";

/**
 * Replacement: the jewellery in a photo of someone wearing it, swapped for
 * another piece, the rest of the photo kept exactly as it was. A first turn
 * sends the photo and the new piece (its product shot, a description, or
 * both); a follow-up sends `change` as well — the result to change and what
 * to change — since every answer is put back into the original photo.
 */
export function replaceJewellery(body: {
  photo: string;
  piece?: string;
  category: ReplacementCategory;
  size?: ReplacementSize | null;
  description?: string;
  /** A `CLEANING_MODELS` id — Replacement is Gemini only. */
  model: string;
  quality?: string;
  preview?: string | null;
  change?: {
    /** The result being changed. Ignored when `source` is "input". */
    image: string;
    instruction: string;
    displayPrompt?: string;
    references?: string[];
    /** "input" when the change was typed on the original photo — the swap is redone with it. */
    source?: "result" | "input";
  };
  conversationId?: string | null;
  parentGenerationId?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/replacement", { method: "POST", body: JSON.stringify(body) });
}

/** A photograph redrawn by hand as a sketch. */
export function imageToSketch(body: {
  image: string;
  style: string;
  /** An `IMAGE_EDIT_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  count: number;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/image-to-sketch", { method: "POST", body: JSON.stringify(body) });
}

// ── product background ───────────────────────────────────────────────────────

/**
 * What goes behind the piece. Transparent, white and a colour are cut out of
 * the photo's own pixels and laid on exactly (no model redraws the piece); a
 * theme is an image model placing it into a scene. See the backend's
 * routes/productBackground.js.
 */
export type ProductBackgroundChoice =
  | { kind: "transparent" }
  | { kind: "white" }
  | { kind: "color"; hex: string }
  | { kind: "theme"; theme: string; prompt?: string };

/** "none", the photo's own contact shadow, or a soft shadow drawn from the piece's outline. */
export type ProductShadow = "none" | "natural" | "soft";

/** Keep the photo's frame, or centre the piece on a square with an even margin. */
export type ProductFraming = "original" | "square";

export type ProductBackgroundTheme = { id: string; label: string; hint: string };

/** The scene presets — the prompt wording stays on the server. */
export function fetchProductBackgroundThemes() {
  return apiRequest<{ themes: ProductBackgroundTheme[] }>("/api/product-background/themes");
}

export function productBackground(body: {
  image: string;
  background: ProductBackgroundChoice;
  shadow?: ProductShadow;
  framing?: ProductFraming;
  /** A scene's own backdrop photo, as a data URI — the piece is placed into it. */
  backdropImage?: string;
  /** Scenes only: a `CLEANING_MODELS` id and its output size. */
  model?: string;
  quality?: string;
  /** Scenes only: versions of the same scene, 1–4. */
  count?: number;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/product-background", { method: "POST", body: JSON.stringify(body) });
}

/** A follow-up on a Product Background result. */
export const refineProductBackground = refineOn<string>("/api/product-background");

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
  /** False for a member's model reached through the viewer's data scope: usable, not renamable. */
  isOwn: boolean;
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
/** `w`/`h` draw the shape on the chip, same convention as `VIDEO_ASPECTS`. */
export const LIFESTYLE_ASPECTS = [
  { id: "4:5", label: "4:5", w: 12, h: 15 },
  { id: "9:16", label: "9:16", w: 9, h: 16 },
  { id: "1:1", label: "1:1", w: 14, h: 14 },
  { id: "16:9", label: "16:9", w: 16, h: 9 },
] as const;
export type LifestyleAspectId = (typeof LIFESTYLE_ASPECTS)[number]["id"];
export const DEFAULT_LIFESTYLE_ASPECT: LifestyleAspectId = "4:5";

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
  /** The shot's frame shape, e.g. "4:5" — a user choice, not left to the model. */
  aspectRatio?: string;
  description?: string;
  /** An `IMAGE_EDIT_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
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
export function refineLifestyle(body: RefineBody<string> & { jewelryImages?: string[] }) {
  return apiRequest<QueuedResult>("/api/lifestyle", { method: "POST", body: JSON.stringify(body) });
}

// ── image to text ────────────────────────────────────────────────────────────

/** Reads one photograph back as the prompt that would recreate it. */
export function imageToText(body: { image: string; preview?: string | null }) {
  return apiRequest<QueuedResult>("/api/image-to-text", { method: "POST", body: JSON.stringify(body) });
}

// ── image to video ───────────────────────────────────────────────────────────

/**
 * Mirrors backend/src/providers/openrouter's OPENROUTER_VIDEO_MODELS and the
 * Gemini Veo list. `durations`/`resolutions` are what each model accepts —
 * the backend clamps to the same lists. Veo runs on the Gemini keys with
 * OpenRouter as a priority-ordered fallback; the rest are OpenRouter only.
 *
 * `badge`s come from a side-by-side test on one of our rings — the same front
 * photo pinned as the first frame and side photo as the last, a quarter-turn
 * between them: Wan 3.0 landed exactly on the side photo with nothing
 * invented; Kling 3.0 Pro turned at the most even speed and ended close.
 *
 * One model per maker, the strongest. Veo 3.1 Fast is gone — both of its runs
 * here failed, and in that test it ended on a different angle with an
 * invented split shank — and so are the budget and draft tiers (Veo Lite,
 * Kling Standard, Wan 2.7, Seedance 2.0 Fast) and Seedance 2.5, which
 * OpenRouter caps at 720p. Kling 3.0 Pro is 720p only, as OpenRouter lists it.
 *
 * Listed worst to best, so the best sits at the bottom of the picker — the
 * menu opens upward from its button, which puts the best one nearest it:
 * Wan 3.0 (exact on the photos), then Kling 3.0 Pro (most even turn), then
 * Veo 3.1 Standard (reliable, but its multi-view 360° got the back wrong),
 * then Seedance 2.0 (not yet tried on a 360° here).
 */
const VEO_DURATIONS = [4, 6, 8] as const;
const BOTH_RES = ["720p", "1080p"] as const;
export const VIDEO_MODELS = [
  { id: "bytedance/seedance-2.0", label: "Seedance 2.0", provider: "ByteDance", description: "Balanced speed & quality · not yet tried on a 360° here", durations: [4, 5, 10], resolutions: BOTH_RES },
  { id: "veo-3.1-generate-preview", label: "Veo 3.1 Standard", provider: "Google", description: "Highest fidelity · richest motion & detail · every run here has worked", durations: VEO_DURATIONS, resolutions: BOTH_RES },
  { id: "kwaivgi/kling-v3.0-pro", label: "Kling 3.0 Pro", provider: "Kling", description: "Most even turning speed in our 360° test · stable object", durations: [5, 10], resolutions: ["720p"], badge: "Smooth 360°" },
  { id: "alibaba/wan-3.0", label: "Wan 3.0", provider: "Alibaba", description: "Lands exactly on your photos · films the pinned 360° · clean backdrops", durations: [5, 8, 10], resolutions: BOTH_RES, badge: "Best 360°" },
] as const;

export type VideoModelId = (typeof VIDEO_MODELS)[number]["id"];
/** The best of them — Wan 3.0, which landed exactly on our photos in the 360° test. */
export const DEFAULT_VIDEO_MODEL: VideoModelId = "alibaba/wan-3.0";

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
 */
export const VIDEO_REFERENCE_MODE = {
  model: "veo-3.1-generate-preview" as VideoModelId,
  aspectRatio: "16:9",
  resolution: "720p",
  durationSeconds: 8,
} as const;

/**
 * The pinned 360° — mirrors TURNTABLE in `backend/src/prompts/video.js`.
 * With the orbit camera, a Front photo and at least one more of Side, Back
 * and Other side, the turn is filmed as segments between those photos on
 * Wan 3.0, each landing exactly on the next photo, and joined into one loop.
 * `angles` are the view labels it pins, in the order the piece turns.
 */
export const VIDEO_TURNTABLE = {
  model: "alibaba/wan-3.0" as VideoModelId,
  angles: ["Front", "Side", "Back", "Other side"],
  lengths: [6, 8, 10, 12, 15],
  defaultLength: 8,
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
  /** The length of the clip — for a pinned 360°, of the finished loop. */
  durationSeconds: number;
  preview?: string | null;
  /** Film a pinned 360° between the labelled photos — see VIDEO_TURNTABLE. */
  turntable?: boolean;
}) {
  return apiRequest<QueuedResult>("/api/image-to-video", { method: "POST", body: JSON.stringify(body) });
}

// ── marketing kit ────────────────────────────────────────────────────────────

/**
 * `collection_story` is an Affinity deck under its own name, and `festive` a
 * set of event posters — they arrive in the `affinity` and `campaign` fields.
 */
export type MarketingKitKind = "brand_story" | "affinity" | "campaign" | "collection_story" | "festive";

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
  /** The run that made it — Campaign Kit and Festive Poster tiles open it in the results viewer. */
  generationId?: string | null;
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
    /** Collection Story's groups; empty for Affinity and a one-group story. */
    categories?: DeckCategory[];
    items: AffinityItem[];
    originalItems: AffinityItem[];
    /** The editor's layout of the deck; null until it is first opened in the editor. */
    design?: unknown;
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

/** One of a Campaign Kit's four shots (or a Festive kit's posters). Points at an Asset, not its own copy. */
export type CampaignShot = {
  /** A Campaign Kit shot id, or `poster1`… for a Festive kit. */
  id: string;
  label: string;
  assetId: string | null;
  url: string;
  thumbnailUrl: string | null;
  /** The only editable field — the rest is what the run produced. */
  caption: string;
};

/** Several photos of one piece, read as a design narrative. */
/** The voices a Brand Story can be written in — the backend's BRAND_STORY_TONES. */
export type BrandStoryTone = "classic" | "romantic" | "modern" | "poetic" | "bold" | "heritage";
/** How long it runs — the backend's BRAND_STORY_LENGTHS. */
export type BrandStoryLength = "short" | "medium" | "long";

export function brandStory(body: {
  images: string[];
  sheetImages?: string[];
  preview?: string | null;
  tone?: BrandStoryTone;
  length?: BrandStoryLength;
}) {
  return apiRequest<QueuedResult>("/api/marketing-kit/brand-story", { method: "POST", body: JSON.stringify(body) });
}

/**
 * Several pieces turned into catalog copy.
 *
 * Workbooks are parsed to text in the browser — `sheetExcelText` is that
 * text. Keeping the parser client-side is what stops the backend carrying a
 * spreadsheet library for one tool.
 */
export function affinity(
  body: {
    items: { image: string; sheetImages?: string[]; sheetExcelText?: string[] }[];
    preview?: string | null;
    /** Collection Story: the groups, by position in `items`. The label is only a hint for the AI-written name. */
    categories?: { label: string; pieceIndexes: number[]; coverIndex: number }[];
  },
  /** Collection Story is the same run under its own name and endpoint. */
  kind: "affinity" | "collection_story" = "affinity"
) {
  const path = kind === "collection_story" ? "/api/marketing-kit/collection-story" : "/api/marketing-kit/affinity";
  return apiRequest<QueuedResult>(path, { method: "POST", body: JSON.stringify(body) });
}

/** Up to six pieces together in one event-themed poster, optionally in several variations. */
export function festivePoster(body: {
  jewelryImages: string[];
  /** A `FESTIVE_EVENTS` id; ignored when `customEvent` is set. */
  event?: string;
  customEvent?: string;
  description?: string;
  /** Words written onto the poster, in a chosen title font ("surprise" picks one per variation). Omit for no text. */
  text?: { headline: string; subtitle?: string; tagline?: string; font: string; placement: "left" | "center" | "right" };
  aspect: string;
  count: number;
  /** An `IMAGE_EDIT_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  quality?: string;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/marketing-kit/festive", { method: "POST", body: JSON.stringify(body) });
}

/** Retouching one festive poster. */
export const refineFestivePoster = refineOn<string>("/api/marketing-kit/festive");

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
  /** An `IMAGE_EDIT_MODELS` id — the backend resolves which provider it belongs to. */
  model: string;
  /** Output size, from `qualitiesFor(model)`. Omitted runs at the model's best. */
  quality?: string;
  preview?: string | null;
}) {
  return apiRequest<QueuedResult>("/api/marketing-kit/campaign", { method: "POST", body: JSON.stringify(body) });
}

/** Retouching one shot of a kit. `shotLabel` tells the backend whether a person is in it. */
export const refineCampaignKit = (body: RefineBody<string> & { shotLabel?: string }) =>
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

/** The catalog's setting-code table — code → the words the deck uses for it. */
export function fetchSettingCodes() {
  return apiRequest<{ codes?: Record<string, string> }>("/api/marketing-kit/setting-codes");
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
    /** Names, taglines and covers — which pieces a category holds is fixed at upload. */
    categories?: DeckCategory[];
    /** Captions only — a shot's id, label and url are not the client's to change. */
    shots?: { id: string; caption: string }[];
    /** The editor's whole document — see lib/deckDesign.ts. */
    design?: unknown;
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

// ── jewellery trends ─────────────────────────────────────────────────────────

/** One current design direction — what a "Trending" design style sends an image after. */
export type JewelryTrend = {
  label: string;
  hint: string;
  /** What the design looks like — sent to the model with each image that follows it. */
  cue: string;
  /** The builder selections that define it, `{ groupKey: option }`. */
  picks: Record<string, string>;
};

/** What a generation is sent of a trend: its name and what it looks like. */
export type TrendCue = Pick<JewelryTrend, "label" | "cue">;

/**
 * The current trends for one audience and jewellery type — searched on the
 * live web once a month, a curated list until then. `options` is the builder's
 * own lists, so the picks a trend comes back with are ones it can select.
 */
export function fetchTrends(body: { audience: string; type: string; options: Record<string, string[]> }) {
  return apiRequest<{
    trends?: JewelryTrend[];
    /** What is in fashion row by row, `{ settingStyle: ["Bezel", "Flush Set"] }` — the builder's flames. */
    trending?: Record<string, string[]>;
    /** "web" once this month's search has landed; "curated" until then. */
    source?: "web" | "curated";
    period?: string | null;
    /** A search is still running — a later load will have its answer. */
    refreshing?: boolean;
  }>("/api/trends", { method: "POST", body: JSON.stringify(body) });
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
  /** The image(s) the run was given — lets a text-out tool's tile show what the answer is about. */
  inputAssets?: HistoryOutput[];
  /** What a text-out tool produced. Null for every tool that makes pictures. */
  text?: string | null;
  /**
   * The Marketing Kit this run wrote, where it wrote one — so History can
   * open the deck rather than show the model's raw JSON, which is what an
   * Affinity run's stored text actually is.
   */
  kitId?: string | null;
  /** Which surface wrote that deck. Null on older runs, which are all Affinity. */
  kitKind?: MarketingKitKind | null;
  /** A tool's sub-mode with a page of its own — Image Cleaning's "product_views". */
  mode?: string | null;
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
  /** What a text-out tool produced. Null for every tool that makes pictures. */
  text?: string | null;
  /** A Product Views turn: the piece, and the angle of each input and output asset. */
  productViews?: {
    category: ProductViewCategory;
    photoViews: ProductViewId[];
    /** Null on runs recorded before the angles were stored. */
    outputViews: ProductViewId[] | null;
  };
  /** A Replacement turn: what the new piece is. The photo and product shot are the first turn's inputs. */
  replacement?: {
    category: ReplacementCategory;
    size: ReplacementSize | null;
    description: string | null;
  };
};

/**
 * The full thread behind one History tile, in turn order — fetched when a
 * tool page is asked to resume a past conversation rather than start fresh.
 *
 * The owner gets it to continue. Someone else gets it only with
 * `org.conversations.read` and within their data scope, and then with
 * `readOnly: true` — the page must drop its composer, and the server refuses
 * a turn on it anyway. Anyone else gets a 403.
 */
export function fetchConversation(conversationId: string) {
  return apiRequest<{
    tool: string;
    readOnly?: boolean;
    /** Who the thread belongs to, when it is not the viewer's. */
    ownerName?: string | null;
    generations: ConversationTurn[];
  }>(`/api/history/conversations/${conversationId}`);
}

/** A loaded thread, and whether the viewer may add to it. */
export type ConversationThread = {
  generations: ConversationTurn[];
  /** Someone else's chat, opened to read. No composer, no retry, no hints. */
  readOnly: boolean;
  ownerName: string | null;
};

/**
 * `fetchConversation`, pre-validated for one specific tool's page — every
 * resuming page needs the same "did this load, and is it for this tool"
 * check before touching its own state, so it lives here once instead of
 * being repeated per tool. Returns null on any failure (not found, not
 * allowed, wrong tool, empty thread) so the caller can just bail out.
 */
export async function fetchConversationForTool(conversationId: string, tool: string): Promise<ConversationThread | null> {
  const res = await fetchConversation(conversationId);
  if (res.status !== "success" || res.tool !== tool || res.generations.length === 0) return null;
  return { generations: res.generations, readOnly: Boolean(res.readOnly), ownerName: res.ownerName ?? null };
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
    /** Only rows newer than this — what a live refresh asks for. */
    after?: string;
    limit?: number;
    scope?: "own" | "team";
  } = {}
) {
  const query = new URLSearchParams();
  if (params.after) query.set("after", params.after);
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
  /** `totalImages`: every image the filters match, sent with page one only. */
  return apiRequest<{ items: HistoryItem[]; nextCursor: string | null; canReadTeam: boolean; totalImages?: number }>(
    `/api/history${qs ? `?${qs}` : ""}`
  );
}

/**
 * One result by its generation id — what a Campaign Kit or Festive Poster
 * tile in the Kits tab opens in the results viewer. Those runs are left out
 * of `fetchHistory`, which is why they are fetched one by one.
 */
export function fetchHistoryItem(generationId: string) {
  return apiRequest<{ item: HistoryItem }>(`/api/history/item/${generationId}`);
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

// ── library ──────────────────────────────────────────────────────────────────

/** The library's two halves: the photos people put in, and the pictures the tools made. */
export type LibrarySection = "uploads" | "results";

/**
 * One picture an upload box can offer again — an earlier upload or result,
 * straight off its stored asset. The grid shows `thumbnailUrl`; `url` is the
 * full-size original a pick actually adds.
 */
export type LibraryItem = {
  id: string;
  url: string;
  /** Falls back to `url` server-side when the thumbnail was never made. */
  thumbnailUrl: string;
  tool: string;
  /** "uploaded" or "reference" in the uploads half, "generated" in the results. */
  role: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  userName: string;
  isOwn: boolean;
  /**
   * Which photo this is — the key repeats are collapsed on, so a photo
   * uploaded ten times is offered once. Image Cleaning sends it as a pick's
   * source fingerprint, so "cleaned before" recognises it however it arrived.
   */
  fingerprint: string;
};

/**
 * One page of one library folder, newest first, each photo once. The caller's
 * own pictures unless `scope: "team"`, which reaches exactly as far as
 * History's team view (see `canReadTeam`). `before` is the previous page's
 * `nextCursor`; a page can come back short of `limit` with a cursor still
 * set, which means keep going rather than stop.
 */
export function fetchLibrary(params: {
  section: LibrarySection;
  /** These tools' folders. Empty or omitted is every tool. */
  tools?: string[];
  scope?: "own" | "team";
  /** Just these people inside the team scope — user ids, "me" for the caller. Empty is everyone in reach. */
  members?: string[];
  before?: string | null;
  limit?: number;
}) {
  const query = new URLSearchParams({ section: params.section });
  if (params.tools?.length) query.set("tool", params.tools.join(","));
  if (params.scope === "team") query.set("scope", "team");
  if (params.scope === "team" && params.members?.length) query.set("members", params.members.join(","));
  if (params.before) query.set("before", params.before);
  if (params.limit) query.set("limit", String(params.limit));
  return apiRequest<{ items: LibraryItem[]; nextCursor: string | null; canReadTeam: boolean }>(`/api/library?${query}`);
}

/** Which tools each half of the library has anything from — the folders worth offering. */
export function fetchLibraryFolders(scope: "own" | "team" = "own", members: string[] = []) {
  const query = new URLSearchParams();
  if (scope === "team") query.set("scope", "team");
  if (scope === "team" && members.length) query.set("members", members.join(","));
  return apiRequest<{
    uploads: string[];
    results: string[];
    /** Teammates in reach with pictures, not counting the caller. Empty without `result.read.others`. */
    members: { id: string; name: string }[];
    canReadTeam: boolean;
  }>(`/api/library/folders${query.size ? `?${query}` : ""}`);
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
  /** Credits topped up to each day, or null when the member is not on a daily allowance. */
  dailyAllowance?: number | null;
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

/**
 * Sets a member's daily allowance, or turns it off with `amount: null`.
 * Takes effect at once: their unspent credits return to the pool and the
 * allowance is paid out of it. `tenantId` is only honoured for a super admin.
 */
export function setDailyAllowance(body: { userId: string; amount: number | null; tenantId?: string }) {
  return apiRequest("/api/credits/daily-allowance", { method: "POST", body: JSON.stringify(body) });
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

/** Every organization's ledger at once, for the audit log's credit view. Super admin only. */
export function fetchAllCreditLedger({
  tenantIds = [],
  kinds = [],
  before,
  limit = 50,
}: { tenantIds?: string[]; kinds?: CreditEntry["kind"][]; before?: string | null; limit?: number } = {}) {
  const params = new URLSearchParams({ limit: String(limit) });
  tenantIds.forEach((id) => params.append("tenantId", id));
  kinds.forEach((kind) => params.append("kind", kind));
  if (before) params.set("before", before);
  return apiRequest<{
    entries: (CreditEntry & { tenant: string | null })[];
    hasMore: boolean;
    nextCursor: string | null;
  }>(`/api/credits/ledger?${params}`);
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
