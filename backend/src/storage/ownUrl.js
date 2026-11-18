const config = require("../config");

/**
 * Whether a url really points at this app's own public bucket.
 *
 * Every caller hands a caller-supplied url to `fetch`, so this check is the
 * only thing standing between them and an open relay that will make the
 * server request anything a signed-in user names.
 *
 * Compared by parsed origin, not by string prefix: `startsWith` accepts
 * `https://pub-xxxx.r2.dev.attacker.example/…`, which begins with the
 * configured url and is an entirely different host. Parsing also rejects a
 * protocol swap and anything that isn't a url at all.
 */
function isOwnPublicUrl(value) {
  if (typeof value !== "string" || !config.r2.publicUrl) return false;

  let candidate;
  let base;
  try {
    candidate = new URL(value);
    base = new URL(config.r2.publicUrl);
  } catch {
    return false;
  }

  if (candidate.origin !== base.origin) return false;

  // A public url configured with a path prefix confines us to that subtree;
  // one pointing at the bucket root ("/") imposes no further restriction.
  const basePath = base.pathname.replace(/\/+$/, "");
  return basePath === "" || candidate.pathname.startsWith(`${basePath}/`);
}

module.exports = { isOwnPublicUrl };
