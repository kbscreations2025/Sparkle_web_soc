import { cn } from "@/lib/utils";

/**
 * A page's error line — the one style the console pages and the audit log
 * report a failed load or action in. Renders nothing while `message` is empty.
 * `className` adds layout classes such as `shrink-0` in a flex column.
 */
export function ErrorBanner({ message, className }: { message: string; className?: string }) {
  if (!message) return null;
  return (
    <p className={cn(className, "rounded-lg border border-error/20 bg-error/[0.08] px-3 py-2 text-xs text-error")}>
      {message}
    </p>
  );
}
