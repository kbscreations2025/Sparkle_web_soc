"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { listAppUsers, type AppUser } from "@/lib/api";
import { CELL, HEAD_ROW, TABLE_FRAME } from "@/components/admin/table";
import { ErrorBanner } from "@/components/admin/ErrorBanner";
import { useConsoleLoad } from "@/components/admin/useConsoleLoad";
import { cn } from "@/lib/utils";

export default function AppUsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const { loading, error } = useConsoleLoad(listAppUsers, (result) => {
    if (result.status === "success") setUsers(result.users ?? []);
    else return result.message || "Could not load app users";
  });

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="space-y-1">
          <h1 className="font-serif text-2xl text-cream md:text-3xl">App Users</h1>
          <p className="max-w-2xl text-sm text-muted">
            Everyone the central login has registered against this application. This is a read-only
            directory — users can&apos;t be added or removed from here.
          </p>
        </header>

        <ErrorBanner message={error} />

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-faint">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </p>
        ) : error ? null : users.length === 0 ? (
          <p className="text-sm text-muted">No users found.</p>
        ) : (
          <div className={TABLE_FRAME}>
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className={HEAD_ROW}>
                  <th className={CELL}>Name</th>
                  <th className={CELL}>Email</th>
                  <th className={CELL}>Role</th>
                  <th className={CELL}>Status</th>
                  <th className={CELL}>Granted</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.user_id} className="border-t border-white/5">
                    <td className={cn(CELL, "font-medium text-cream")}>{user.name || "—"}</td>
                    <td className={cn(CELL, "text-muted")}>{user.email}</td>
                    <td className={cn(CELL, "text-muted")}>{user.role || "—"}</td>
                    <td className={cn(CELL, "text-muted")}>{user.status || "—"}</td>
                    <td className={cn(CELL, "text-muted")}>
                      {user.grantedAt ? new Date(user.grantedAt).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
