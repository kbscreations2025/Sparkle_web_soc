const crypto = require("crypto");

require("./config"); // ensures .env is loaded before the key ring is read

// Envelope encryption for tenant-owned provider API keys.
//
// Every credential stores the keyVersion that encrypted it, so a KEK can be
// retired without a big-bang re-encryption: old versions stay in the ring for
// decryption while only the active version is used for new writes.
//
// Env shape:  AI_KEK_V1=<base64 32 bytes>, AI_KEK_V2=..., AI_KEK_ACTIVE_VERSION=2
const KEY_ENV_PATTERN = /^AI_KEK_V(\d+)$/;
const IV_BYTES = 12; // GCM's native nonce size
const KEY_BYTES = 32; // AES-256

let ring = null;

function keyRing() {
  if (ring) return ring;

  ring = new Map();
  for (const [name, value] of Object.entries(process.env)) {
    const match = KEY_ENV_PATTERN.exec(name);
    if (!match || !value) continue;

    const key = Buffer.from(value, "base64");
    if (key.length !== KEY_BYTES) {
      throw new Error(`${name} must be ${KEY_BYTES} bytes of base64 (AES-256)`);
    }
    ring.set(Number(match[1]), key);
  }

  if (ring.size === 0) throw new Error("no AI_KEK_V<n> keys configured");
  return ring;
}

function activeKeyVersion() {
  const configured = Number(process.env.AI_KEK_ACTIVE_VERSION);
  // Default to the highest key present so adding AI_KEK_V2 is enough to rotate.
  const version = Number.isInteger(configured) ? configured : Math.max(...keyRing().keys());
  if (!keyRing().has(version)) throw new Error(`AI_KEK_V${version} is not configured`);
  return version;
}

function keyFor(version) {
  const key = keyRing().get(version);
  if (!key) throw new Error(`cannot decrypt: AI_KEK_V${version} is not in the key ring`);
  return key;
}

// The provider name is bound in as additional authenticated data so a
// ciphertext can't be lifted out of one provider entry and replayed under
// another — decryption fails outright rather than handing the wrong key to the
// wrong API.
function aadFor(provider) {
  if (!provider) throw new Error("provider is required to bind the credential");
  return Buffer.from(String(provider), "utf8");
}

function encryptSecret(plaintext, { provider }) {
  if (!plaintext) throw new Error("nothing to encrypt");

  const keyVersion = activeKeyVersion();
  const iv = crypto.randomBytes(IV_BYTES); // fresh per encryption, never reused
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFor(keyVersion), iv, {
    authTagLength: 16,
  });
  cipher.setAAD(aadFor(provider));

  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion,
  };
}

function decryptSecret(credential, { provider }) {
  if (!credential?.ciphertext) throw new Error("credential is missing or was not selected");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    keyFor(credential.keyVersion),
    Buffer.from(credential.iv, "base64"),
    { authTagLength: 16 }
  );
  decipher.setAAD(aadFor(provider));
  decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(credential.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

// Re-wraps an existing credential under the active KEK. Plaintext never leaves
// this function, so a rotation job needs no access to the raw keys.
function rotateCredential(credential, { provider }) {
  if (credential.keyVersion === activeKeyVersion()) return null; // already current
  return encryptSecret(decryptSecret(credential, { provider }), { provider });
}

// HMAC rather than a bare digest: API keys have low entropy in their prefix and
// a plain sha256 would let anyone with the DB confirm a guessed key offline.
function fingerprintSecret(plaintext) {
  const pepper = process.env.AI_KEY_FINGERPRINT_PEPPER;
  if (!pepper) throw new Error("AI_KEY_FINGERPRINT_PEPPER is not configured");
  return crypto.createHmac("sha256", pepper).update(String(plaintext), "utf8").digest("hex");
}

function fingerprintMatches(plaintext, storedFingerprint) {
  if (!storedFingerprint) return false;
  const a = Buffer.from(fingerprintSecret(plaintext), "hex");
  const b = Buffer.from(storedFingerprint, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Safe to return to the UI: enough to tell two keys apart, not enough to use.
function hintSecret(plaintext) {
  const value = String(plaintext);
  return value.length <= 8 ? "…" : `${value.slice(0, 3)}…${value.slice(-4)}`;
}

module.exports = {
  activeKeyVersion,
  encryptSecret,
  decryptSecret,
  rotateCredential,
  fingerprintSecret,
  fingerprintMatches,
  hintSecret,
};
