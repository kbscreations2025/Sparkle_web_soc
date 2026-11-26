"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { LookbookBuilder } from "@/components/lookbook/builder/LookbookBuilder";
import { ToolAccessNotice } from "@/components/studio/ToolAccessNotice";
import { fetchLookbook, type Lookbook } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { LOOKBOOK_PERMISSION } from "@/lib/lookbook/access";
import { can } from "@/lib/permissions";

type Load = { state: "loading" } | { state: "ready"; lookbook: Lookbook } | { state: "failed"; message: string };

export default function LookbookBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const allowed = can(user, LOOKBOOK_PERMISSION);
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    if (!allowed) return;
    let live = true;
    fetchLookbook(id).then((result) => {
      if (!live) return;
      if (result.status === "success" && result.lookbook) setLoad({ state: "ready", lookbook: result.lookbook });
      else setLoad({ state: "failed", message: result.code === "not_found" ? "This lookbook doesn't exist, or it isn't yours." : result.message || "Couldn't open this lookbook." });
    });
    return () => {
      live = false;
    };
  }, [id, allowed]);

  if (!allowed) return <ToolAccessNotice tool="Live Lookbook" />;

  if (load.state === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted">
        <Loader2 size={16} className="animate-spin" /> Opening the lookbook…
      </div>
    );
  }

  if (load.state === "failed") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-[14px] text-cream">{load.message}</p>
        <Link href="/live-lookbook" className="flex items-center gap-1.5 text-[13px] font-medium text-gold hover:underline">
          <ArrowLeft size={14} /> All lookbooks
        </Link>
      </div>
    );
  }

  // Keyed on the lookbook, so opening another starts a fresh editor with its own history.
  return <LookbookBuilder key={load.lookbook.id} initial={load.lookbook} />;
}
