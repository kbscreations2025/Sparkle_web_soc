"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { listAppUsers, type AppUser } from "@/lib/api";
import { CELL, HEAD_ROW, TABLE_FRAME } from "@/components/admin/table";
import { cn } from "@/lib/utils";

export default function AppUsersPage() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listAppUsers()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "success") setUsers(result.users ?? []);
        else setError(result.message || "Could not load app users");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not reach the server");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

        {error && (
          <p className="rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error">
            {error}
          </p>
        )}

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
