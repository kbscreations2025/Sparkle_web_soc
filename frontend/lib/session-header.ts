import type { ApiUser } from "./api";

/**
 * How the proxy hands the verified user to the app. It has already called the
 * backend to check the session, so passing the result along with the HTML saves
 * the client from asking the same question a second time on every page load.
 */
export const USER_HEADER = "x-sparkle-user";

// Base64 because header values must be ASCII and a name may not be.
export function encodeUser(user: ApiUser): string {
  return Buffer.from(JSON.stringify(user), "utf8").toString("base64");
}

export function decodeUser(encoded: string | null): ApiUser | null {
  if (!encoded) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}
