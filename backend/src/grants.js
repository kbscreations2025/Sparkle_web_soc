/**
 * The catalogue of grants this application understands. The admin console
 * offers exactly these, and every write validates against them — so a typo
 * like "tool.cleanning.run" fails loudly instead of silently hiding a tool.
 *
 * The tool keys are also the `toolKey` values `dataScope.toolKeys` limits, and
 * they must match the ids in `frontend/lib/nav.ts`. A key on only one side is
 * a tool nobody can reach.
 */
const TOOLS = [
  { key: "cleaning", label: "Image Cleaning" },
  { key: "life_style", label: "Lifestyle" },
  { key: "image_to_video", label: "Image to Video" },
  { key: "text_to_image", label: "Text to Image" },
  { key: "text_to_sketch", label: "Text to Sketch" },
  { key: "sketch_to_image", label: "Sketch to Image" },
  { key: "image_to_text", label: "Image to Text" },
  { key: "image_to_sketch", label: "Image to Sketch" },
  { key: "marketing_kit", label: "Marketing Kit" },
  { key: "chat_to_edit", label: "Chat to Edit" },
];

const TOOL_KEYS = TOOLS.map((tool) => tool.key);

// Grouped so the console can render them as sections rather than one flat list.
const GRANT_GROUPS = [
  {
    id: "tools",
    label: "Tools",
    grants: [
      { grant: "tool.*.run", label: "All tools", hint: "Covers every tool, including ones added later" },
      ...TOOLS.map((tool) => ({ grant: `tool.${tool.key}.run`, label: tool.label })),
    ],
  },
  {
    id: "results",
    label: "Results",
    grants: [
      {
        grant: "result.read.own",
        label: "See their own results",
        /*
         * Everyone gets this — see BASELINE_GRANTS. Offered as a checkbox it
         * could only ever be ticked, since unticking it is undone on the next
         * save, and a control that cannot change anything is worse than no
         * control. Still a real grant: it is what `resultReadFilter` reads.
         */
        hidden: true,
        hint: "Everyone sees their own results — the History page needs it",
      },
      {
        grant: "result.read.others",
        label: "See other people's results",
        /*
         * Not offered as a checkbox any more — the data scope says the same
         * thing and says it better. "None" means their own work, "Selected"
         * and "All" mean further, and a grant that only ever agreed with
         * the scope was a second click that could disagree with it.
         *
         * Still listed here, and still a real grant: `resultReadFilter` and
         * `canExport` read it, existing rows carry it, and dropping it from
         * the catalogue would make `unknownGrants` reject every save of a
         * member who has it. It is now derived from the scope on write —
         * see `withScopeGrant`.
         */
        hidden: true,
        hint: "Set by the data scope below, not ticked directly",
      },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    grants: [
      {
        grant: "org.audit.read",
        label: "Read the audit log",
        // Worth spelling out: unlike `result.read.others`, this one is not
        // narrowed by the data scope. The audit log is an accountability
        // record, and one filtered to a subset of colleagues would be
        // misleading rather than merely partial.
        hint: "Every tracked action in their own organization — not narrowed by the data scope",
      },
      {
        grant: "org.credits.read",
        label: "See the organization's credits",
        hint: "The organization's balance and what each member holds — their own organization only",
      },
      {
        grant: "org.credits.manage",
        /*
         * Distribute, not grant. This moves credits that the organization
         * already holds from its pool to its people; it cannot create any.
         * Issuing new credit stays with platform staff, because an admin who
         * could mint their own would be an admin with an unlimited budget.
         */
        label: "Share out the organization's credits",
        hint: "Move credits from the organization's pool to its members, and take them back",
      },
      {
        grant: "org.members.manage",
        /*
         * Delegation, not administration. A holder may tick a permission for
         * a colleague only if they hold it themselves, and may never edit
         * their own row — so this grant can widen what the team can do, but
         * never what its holder can do. See routes/orgMembers.js, which is
         * where both rules are enforced.
         */
        label: "Manage their colleagues' permissions",
        hint: "Only permissions they hold themselves, and never their own — their own organization only",
      },
      {
        grant: "org.conversations.read",
        /*
         * Reading, never continuing. The holder can open a colleague's chat
         * from History and see every turn, but the composer is gone and the
         * server refuses a new turn on a conversation that is not theirs
         * (generationService.recordGeneration) — a next turn would be billed
         * to and attributed to whoever sent it, not who started the thread.
         * Still bounded by the data scope: it opens chats behind results the
         * holder can already see, not anyone's in the organization.
         */
        label: "Open colleagues' chats, read-only",
        hint: "Every turn of a chat behind a result they can see — they cannot continue it",
      },
      {
        grant: "org.results.delete",
        /*
         * Their own results can always be deleted; this is for everyone
         * else's. Bounded by the data scope like reading is, so it removes
         * only what the holder can already see in History — and every such
         * delete is audited, since the owner is not the one doing it.
         */
        label: "Delete colleagues' results",
        hint: "Permanently removes a result they can see, and its files — recorded in the audit log",
      },
    ],
  },
];

const ALL_GRANTS = GRANT_GROUPS.flatMap((group) => group.grants.map((entry) => entry.grant));

/**
 * The grants that only make sense for an admin, and are taken away when
 * someone's role drops back to "user".
 *
 * Everything here is organization-wide: its credits, its audit trail, its
 * people. How far someone sees into *colleagues' results* is deliberately
 * NOT on this list — that is the data scope, and any member can be given
 * one, admin or not.
 *
 * This is the one place `role` has any bearing on permissions, and it is
 * still not an authorization decision: `hasPermission` never reads the role
 * (see permissions.js). It is a *write* rule — demoting someone removes the
 * grants their new role has no use for, so the console can stop offering
 * them without ever hiding a permission that is quietly still in force.
 */
const ADMIN_ONLY_GRANTS = GRANT_GROUPS.find((group) => group.id === "organization").grants.map(
  (entry) => entry.grant
);

/**
 * What everybody gets, whatever their role and whether or not anyone ticks
 * it.
 *
 * Seeing your own work is the baseline of having an account here, not a
 * feature to be switched on — for an admin as much as a member. So it is no
 * longer offered as a checkbox (the entry is `hidden`, which empties the
 * Results group and removes the section), and this makes sure not offering
 * it never means withholding it: someone created with no permissions at all
 * still gets their own History.
 */
const BASELINE_GRANTS = ["result.read.own"];

/** Adds the grants nobody has to ask for. */
function withBaselineGrants(permissions) {
  const set = new Set(permissions || []);
  for (const grant of BASELINE_GRANTS) set.add(grant);
  return [...set];
}

/**
 * Keeps `result.read.others` in step with the data scope.
 *
 * The scope is the control now, and this is the grant it implies: "None"
 * means their own work and nothing else, anything wider means they reach
 * colleagues. Derived rather than ticked, so the two can never disagree —
 * which they could before, leaving a scope pointing at people the grant
 * would not let through.
 */
function withScopeGrant(permissions, scopeKind) {
  const set = new Set(permissions || []);
  if (scopeKind && scopeKind !== "own") set.add("result.read.others");
  else set.delete("result.read.others");
  return [...set];
}

/**
 * What `permissions` should become for someone being set to `role`, and the
 * scope that goes with it. Returns null when nothing has to change.
 */
function demoteGrants(role, permissions) {
  if (role !== "user") return null;

  const kept = (permissions || []).filter((grant) => !ADMIN_ONLY_GRANTS.includes(grant));
  if (kept.length === (permissions || []).length) return null;

  // The data scope is deliberately left alone. A plain member is allowed a
  // scope — being pointed at a colleague's work is not an admin power — so
  // demoting someone takes away the organization-wide grants and nothing
  // about whose results they were asked to keep an eye on.
  return { permissions: kept };
}

/** Returns the entries of `list` that aren't in the catalogue. */
function unknownGrants(list) {
  return (list || []).filter((grant) => !ALL_GRANTS.includes(grant));
}

/**
 * Every grant rule at once: what a role gets for free, what its data scope
 * implies, and what its role has no use for.
 *
 * One function because these three are not independent decisions — they are
 * one question ("given this role and this scope, what should this person
 * hold?") that was previously answered by composing three helpers by hand at
 * every write site. Three sites did that, and one of them forgot
 * `demoteGrants`, so a member created as "user" with organization-wide
 * grants kept them: live on the server, and invisible in a console that
 * hides that section for non-admins.
 *
 * Called from a `pre("validate")` hook on the User model, so it applies to
 * every save rather than to the sites someone remembered.
 */
function normalizeGrants({ role, permissions, scopeKind }) {
  const withBaseline = withBaselineGrants(permissions);
  const withScope = withScopeGrant(withBaseline, scopeKind);
  return demoteGrants(role, withScope)?.permissions ?? withScope;
}

module.exports = {
  TOOLS,
  TOOL_KEYS,
  normalizeGrants,
  GRANT_GROUPS,
  ALL_GRANTS,
  ADMIN_ONLY_GRANTS,
  BASELINE_GRANTS,
  demoteGrants,
  withScopeGrant,
  withBaselineGrants,
  unknownGrants,
};
