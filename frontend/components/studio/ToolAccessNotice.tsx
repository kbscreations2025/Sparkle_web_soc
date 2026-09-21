/**
 * What a tool page renders instead of itself when the viewer lacks its grant.
 *
 * Every tool had its own copy of this markup and sentence — thirteen of
 * them, already drifted in wording. The page still decides *whether* to
 * show it, because the check has to happen after the page's hooks have run
 * and React will not have hooks disappear on a re-render; only the message
 * lives here.
 */
export function ToolAccessNotice({ tool }: { tool: string }) {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-8">
      <p className="text-sm text-muted">
        {tool} isn&apos;t enabled for your account. Ask an admin to grant you access.
      </p>
    </div>
  );
}
