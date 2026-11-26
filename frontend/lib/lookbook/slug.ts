/**
 * A typed name as a link name, the same way the server makes one
 * (backend/src/services/lookbooks.js, normalizeSlug): lower case, accents
 * dropped, every run of anything else turned into one hyphen. Used to show the
 * link as it's typed; the server's version is the one that counts.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

/** The public page's address, on this app's own domain. */
export function publicUrl(slug: string, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/l/${slug}`;
}
