#!/usr/bin/env node
/**
 * Encrypt or decrypt the expiry "time" used by the Shafaf app (license server).
 * Uses same algorithm as src-tauri/src/license.rs: derive_key() + EXPIRY_SALT nonce + AES-256-GCM.
 *
 * Usage:
 *   node scripts/decrypt-expiry-time.cjs encrypt <datetime>
 *     e.g. node scripts/decrypt-expiry-time.cjs encrypt "2027-02-07T05:35:35"
 *   node scripts/decrypt-expiry-time.cjs decrypt [hex_string]
 *     If no hex_string, uses a default sample.
 */

const crypto = require("crypto");

const SECRET_KEY_BASE = "com.sulaiman.financeapp.license.secret.2024";
const SALT = "finance-app-salt-2024";
const EXPIRY_SALT = "finance-app-expiry-salt-2024";

function deriveKey() {
  const h = crypto.createHash("sha256");
  h.update(SECRET_KEY_BASE, "utf8");
  h.update(SALT, "utf8");
  return h.digest().slice(0, 32);
}

function deriveExpiryNonce(plaintext) {
  const h = crypto.createHash("sha256");
  h.update(plaintext, "utf8");
  h.update(EXPIRY_SALT, "utf8");
  return h.digest().slice(0, 12);
}

function encryptExpiryTime(datetimeStr) {
  const key = deriveKey();
  const nonce = deriveExpiryNonce(datetimeStr);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(datetimeStr, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([nonce, encrypted, tag]);
  return combined.toString("hex");
}

function decryptExpiryTime(hexCiphertext) {
  const bytes = Buffer.from(hexCiphertext, "hex");
  if (bytes.length < 12 + 16) {
    throw new Error("Ciphertext too short (need nonce + ciphertext + tag)");
  }
  const key = deriveKey();
  const nonce = bytes.subarray(0, 12);
  const ciphertextWithTag = bytes.subarray(12);
  const authTag = ciphertextWithTag.subarray(-16);
  const ciphertextOnly = ciphertextWithTag.subarray(0, -16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(ciphertextOnly), decipher.final()]);
  return plain.toString("utf8");
}

const mode = process.argv[2]?.toLowerCase();
const value = process.argv[3];

const defaultHex =
  "ef45d059eab2f88227672ef73a7581e938c0ec4e71bff4e79a3222c3ae0b822718906c8544e3859055477f302b7d28";

try {
  if (mode === "encrypt") {
    if (!value) {
      console.error("Usage: node decrypt-expiry-time.cjs encrypt <datetime>");
      console.error('  e.g. node decrypt-expiry-time.cjs encrypt "2027-02-07T05:35:35"');
      process.exit(1);
    }
    const hex = encryptExpiryTime(value.trim());
    console.log("Encrypted expiry (hex):", hex);
  } else if (mode === "decrypt") {
    const hexInput = value?.trim() || defaultHex;
    const decrypted = decryptExpiryTime(hexInput);
    console.log("Decrypted expiry (time):", decrypted);
  } else {
    console.error("Usage: encrypt <datetime> | decrypt [hex_string]");
    process.exit(1);
  }
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
