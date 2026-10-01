"use client";

import { useState } from "react";
import { Activity, Shield } from "lucide-react";
import type { Member } from "@/lib/api";
import { FilterChecklist, TableFilterBar } from "@/components/admin/TableFilterBar";

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
];
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "removed", label: "Removed" },
];

/**
 * The search and role/status filters every members table shares — the
 * organization's own Credits page and each organization in the super-admin
 * console. One hook so both filter people the same way.
 *
 * `matches` goes to `MemberRows`' `visible`; `bar(members)` renders the strip
 * that sits on top of the table.
 */
export function useMemberFilter() {
  const [query, setQuery] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);

  const needle = query.trim().toLowerCase();
  const filtering = Boolean(needle || roles.length || statuses.length);

  const matches = (member: Member) =>
    (roles.length === 0 || roles.includes(member.role)) &&
    (statuses.length === 0 || statuses.includes(member.status)) &&
    (!needle || `${member.name ?? ""} ${member.email}`.toLowerCase().includes(needle));

  const reset = () => {
    setQuery("");
    setRoles([]);
    setStatuses([]);
  };

  const bar = (members: Member[]) => {
    const shown = filtering ? members.filter(matches).length : members.length;
    return (
      <TableFilterBar
        query={query}
        onQuery={setQuery}
        placeholder="Search name or email"
        onReset={reset}
        canReset={filtering}
        count={
          <span title="Members shown">
            {filtering ? `${shown}/${members.length}` : members.length}
            <span className="hidden sm:inline"> members</span>
          </span>
        }
      >
        <FilterChecklist
          label="Filter by role"
          emptyLabel="Any role"
          icon={<Shield size={13} />}
          values={roles}
          onChange={setRoles}
          options={ROLE_OPTIONS}
        />
        <FilterChecklist
          label="Filter by status"
          emptyLabel="Any status"
          icon={<Activity size={13} />}
          values={statuses}
          onChange={setStatuses}
          options={STATUS_OPTIONS}
        />
      </TableFilterBar>
    );
  };

  return { matches, filtering, reset, bar };
}
