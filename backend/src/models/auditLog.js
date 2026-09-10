const mongoose = require("mongoose");

/**
 * Every action worth being able to answer "who did this, and when" about.
 * Grouped by area rather than alphabetical, so the list reads as a map of
 * what this app tracks — add a new one here before logging it anywhere.
 */
const AUDIT_ACTIONS = [
  // ── auth ──
  "auth.login_success",
  "auth.login_failed",
  "auth.otp_required",
  "auth.otp_verified",
  "auth.otp_failed",
  "auth.session_limit_reached",
  "auth.logout",
  "auth.force_logout_others", // the signing-in user evicting their own other sessions
  "auth.force_logout_by_admin", // an admin evicting someone else's session (suspend/remove)
  // ── organizations ──
  "org.created",
  "org.updated",
  "org.deleted",
  // ── members (role, permissions, dataScope) ──
  "member.added",
  "member.updated",
  "member.removed",
  // ── AI provider keys ──
  "ai_provider.added",
  "ai_provider.updated",
  "ai_provider.deleted",
  // ── generations ──
  "generation.completed",
  "generation.failed",
];

const TARGET_TYPES = ["tenant", "user", "aiProvider", "generation", "session"];

/**
 * One append-only row per tracked action, across every area of the app — not
 * just AI generations. `metadata` is deliberately a free-form bag rather than
 * a rigid schema per action: the set of actions will keep growing, and a
 * fixed shape here would mean a migration every time one needs a new detail.
 *
 * Never put a raw secret in `metadata` — an AI provider key event logs
 * `keyHint`/`label`, never `apiKey`.
 */
const auditLogSchema = new mongoose.Schema(
  {
    // Null for events that happen before a tenant is known — a rejected
    // login attempt, an OTP step, a bad password — not every row has one.
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", default: null },

    // The local User doc, when one exists. Null for a not-yet-provisioned
    // super admin, or for a login attempt central rejected before this app
    // ever looked the person up.
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    // The central login's id — the one identity that's stable even when
    // `actorUserId` is null, so a person can still be traced across rows.
    actorAuthUserId: { type: String, default: null },
    actorEmail: { type: String, default: null, trim: true, lowercase: true },
    actorName: { type: String, default: null, trim: true },

    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    status: { type: String, enum: ["success", "failure"], required: true },

    targetType: { type: String, enum: TARGET_TYPES, default: null },
    // A string, not an ObjectId ref: the target can be a Tenant, a User, an
    // aiProviders subdocument, or a Generation — one column can't `ref` four
    // different collections, and a row surviving its target's deletion still
    // needs to show which id it was.
    targetId: { type: String, default: null },

    // One human-readable line for a table to render without decoding `metadata`.
    message: { type: String, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  // Append-only: nothing here is ever edited after the fact, so there is no
  // `updatedAt` to track — matches Asset's precedent for immutable rows.
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The console's default view: this organization's history, newest first.
auditLogSchema.index({ tenantId: 1, createdAt: -1 });
// "What has this person done" — independent of which org they did it in.
auditLogSchema.index({ actorUserId: 1, createdAt: -1 });
// "Show me every login failure" / "every forced logout" across the app.
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
module.exports.TARGET_TYPES = TARGET_TYPES;
