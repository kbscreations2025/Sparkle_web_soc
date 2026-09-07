const mongoose = require("mongoose");
const { hasPermission } = require("../permissions");

const USER_STATUSES = ["invited", "active", "suspended", "removed"];
const SCOPE_KINDS = ["own", "organization", "selected"];

const dataScopeSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: SCOPE_KINDS, default: "own" },
    userIds: { type: [mongoose.Schema.Types.ObjectId], ref: "User", default: [] },

    // Optional limiters — an *absent* field means "no limit", which is why none
    // of these carry a default. Writing `toolKeys: []` would read as "no tools".
    toolKeys: { type: [String] },
    notBefore: Date,
    canExport: Boolean,

    grantedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    grantedAt: Date,
  },
  { _id: false, minimize: true }
);

dataScopeSchema.path("userIds").validate(function selectedNeedsUserIds(userIds) {
  return this.kind !== "selected" || userIds.length > 0;
}, 'dataScope.kind "selected" requires at least one userId');

const userSchema = new mongoose.Schema(
  {
    // ── identity (mirrored from central login, never authoritative here) ──
    // Credentials, password and MFA live in the central login service. These
    // fields are a cache for display and joins; on conflict the central
    // service wins, so nothing here is ever used to authenticate.
    authUserId: { type: String, required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, trim: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true },

    // ── DISPLAY ONLY. Never read in an authorization decision. ──
    role: { type: String, default: "user" },

    // ── HOW FAR "result.read.others" REACHES. Written by super admin only. ──
    dataScope: { type: dataScopeSchema, default: () => ({ kind: "own" }) },

    // ── THE ACTUAL AUTHORIZATION. Flat, explicit, source of truth. ──
    permissions: { type: [String], default: [] },

    status: { type: String, enum: USER_STATUSES, default: "invited" },

    // Bumped on ANY permission/scope change (enforced by the hook below).
    // Live sockets and cached sessions compare against it to know when their
    // copy of a user's rights went stale.
    permissionVersion: { type: Number, default: 1 },

    // ── platform staff only; false for every real customer ──
    isPlatformAdmin: { type: Boolean, default: false },

    lastLoginAt: Date,
    lastSeenAt: Date,
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One row per person per tenant — the same central-login identity can be a
// member of several tenants, each with its own permissions.
userSchema.index({ authUserId: 1, tenantId: 1 }, { unique: true });
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, status: 1 });

// INVARIANT: permissionVersion must move whenever rights move, otherwise a
// stale session keeps its old grants. Enforced here rather than at each call
// site so no future route can forget it.
userSchema.pre("save", function bumpPermissionVersion() {
  if (this.isNew) return;
  if (
    this.isModified("permissions") ||
    this.isModified("dataScope") ||
    this.isModified("isPlatformAdmin")
  ) {
    this.permissionVersion += 1;
  }
});

// Same invariants on the query path — the pre("save") hook above can't see an
// update that never loads the document.
const GUARDED_PATHS = ["permissions", "dataScope", "isPlatformAdmin"];
const WRITE_QUERIES = ["updateOne", "findOneAndUpdate", "updateMany", "replaceOne"];

// Flattens an update into [path, value] pairs across every operator, so a hook
// doesn't have to care whether it was written as $set, $addToSet or bare.
function* updateEntries(update) {
  for (const [op, value] of Object.entries(update)) {
    if (!op.startsWith("$")) yield [op, value];
    else if (value && typeof value === "object") yield* Object.entries(value);
  }
}

const touchesPath = (update, path) =>
  [...updateEntries(update)].some(([key]) => key === path || key.startsWith(`${path}.`));

userSchema.pre(WRITE_QUERIES, function bumpOnUpdate() {
  const update = this.getUpdate() || {};
  const touches = GUARDED_PATHS.some((path) => touchesPath(update, path));

  if (touches && !update.$inc?.permissionVersion) {
    this.setUpdate({ ...update, $inc: { ...update.$inc, permissionVersion: 1 } });
  }
});

// Document validators can't enforce the dataScope invariant here: on an update,
// Mongoose binds `this` to the query, so a validator on userIds cannot see
// `kind` and would pass anything. A dotted write like {"dataScope.kind":
// "selected"} is unverifiable without first reading the document, so reject it
// and make callers set the whole subdocument (or use applyGrants + save).
userSchema.pre(WRITE_QUERIES, function guardDataScopeUpdate() {
  const update = this.getUpdate() || {};

  for (const [path, value] of updateEntries(update)) {
    if (path.startsWith("dataScope.")) {
      throw new Error(
        `cannot update ${path} in isolation — set the whole dataScope object, or use applyGrants()`
      );
    }
    if (path !== "dataScope") continue;

    const kind = value?.kind ?? "own";
    if (!SCOPE_KINDS.includes(kind)) throw new Error(`invalid dataScope.kind "${kind}"`);
    if (kind === "selected" && !value?.userIds?.length) {
      throw new Error('dataScope.kind "selected" requires at least one userId');
    }
    if (kind !== "selected" && value?.userIds?.length) {
      throw new Error(`dataScope.kind "${kind}" must not carry userIds`);
    }
  }
});

// INVARIANT: userIds is meaningful only for kind "selected". Clearing them on
// the way out means a later switch back to "selected" can't silently restore a
// grant nobody re-approved. Runs pre-validate so the validator below sees the
// normalized value.
userSchema.pre("validate", function normalizeDataScope() {
  if (this.dataScope && this.dataScope.kind !== "selected") this.dataScope.userIds = [];
});

// Mirrors the central login's view of a person into this tenant. Never touches
// permissions, dataScope or role — those are assigned in this application and
// must survive every re-sync from upstream.
userSchema.statics.syncFromCentralLogin = function syncFromCentralLogin({
  authUserId,
  tenantId,
  email,
  name,
}) {
  return this.findOneAndUpdate(
    { authUserId, tenantId },
    {
      $set: { email, ...(name && { name }), lastLoginAt: new Date() },
      $setOnInsert: { status: "invited", permissions: [], permissionVersion: 1 },
    },
    { new: true, upsert: true, runValidators: true }
  ).exec();
};

// Permission and scope writes go through here so the version bump and the
// audit trail on dataScope are never skipped.
userSchema.methods.applyGrants = function applyGrants({ permissions, dataScope, grantedByUserId }) {
  if (permissions) this.permissions = [...new Set(permissions)];
  if (dataScope) {
    this.dataScope = { ...dataScope, grantedByUserId, grantedAt: new Date() };
  }
  return this;
};

userSchema.methods.can = function can(required) {
  return hasPermission(this, required);
};

module.exports = mongoose.model("User", userSchema);
module.exports.USER_STATUSES = USER_STATUSES;
module.exports.SCOPE_KINDS = SCOPE_KINDS;
