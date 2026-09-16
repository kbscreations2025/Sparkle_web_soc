import { NAV } from "@/lib/nav";

export type Crumb = { label: string; href?: string };

/** Top-level nav hrefs → label, so a crumb can never disagree with the sidebar. */
const NAV_LABEL_BY_HREF: Record<string, string> = Object.fromEntries(
  NAV.filter((item): item is typeof item & { href: string } => Boolean(item.href)).map((item) => [
    item.href,
    item.label,
  ])
);

/** One level below a tool's own href — pages `useNavItems` doesn't know about. */
const SUB_LABELS: Record<string, string> = {
  "/cleaning/default": "Default",
  "/cleaning/dust-scratches": "Dust & Scratches",
};

/** Dashboard → tool → sub-page, derived from the current route. */
export function getBreadcrumbs(pathname: string): Crumb[] {
  if (pathname === "/") return [{ label: "Dashboard" }];

  const crumbs: Crumb[] = [{ label: "Dashboard", href: "/" }];

  const topHref = Object.keys(NAV_LABEL_BY_HREF).find(
    (href) => pathname === href || pathname.startsWith(`${href}/`)
  );
  if (topHref) {
    crumbs.push({ label: NAV_LABEL_BY_HREF[topHref], href: pathname === topHref ? undefined : topHref });
  }

  const subLabel = SUB_LABELS[pathname];
  if (subLabel) crumbs.push({ label: subLabel });

  return crumbs;
}
