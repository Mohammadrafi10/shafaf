import { invoke } from "@tauri-apps/api/core";

/**
 * Get the machine ID for this device
 * @returns Promise with machine ID string
 */
export async function getMachineId(): Promise<string> {
  return await invoke<string>("get_machine_id");
}

/**
 * Store license key in secure storage
 * @param key The encrypted license key to store
 * @returns Promise that resolves when key is stored
 */
export async function storeLicenseKey(key: string): Promise<void> {
  return await invoke<void>("store_license_key", { key });
}

/**
 * Get the stored license key from secure storage
 * @returns Promise with license key or null if not found
 */
export async function getLicenseKey(): Promise<string | null> {
  const key = await invoke<string | null>("get_license_key");
  return key;
}

/**
 * Get the stored license expiry (ISO datetime) from secure storage on this machine.
 * @returns Promise with expiry string or null if not found
 */
export async function getLicenseExpiry(): Promise<string | null> {
  return await invoke<string | null>("get_license_expiry");
}

/**
 * Validate a license key by encrypting current machine ID and comparing
 * @param key The license key to validate
 * @returns Promise with boolean indicating if key is valid
 */
export async function validateLicenseKey(key: string): Promise<boolean> {
  return await invoke<boolean>("validate_license_key", { enteredKey: key });
}

export interface LicenseCheckResult {
  valid: boolean;
  reason?: "expired" | "invalid";
}

/**
 * Insert the license key into the remote MySQL license table (auto when user clicks Activate).
 * Uses default expiry of 1 year. Safe to call if key already exists (upsert).
 */
export async function registerLicenseOnServer(key: string): Promise<void> {
  return await invoke<void>("register_license_on_server", { licenseKey: key });
}

/**
 * Refresh license expiry from server: fetch encrypted expiry, decrypt, and update local keyring.
 * Call when the server expiry may have been extended (e.g. by admin).
 */
export async function refreshLicenseExpiryFromServer(): Promise<void> {
  return await invoke<void>("refresh_license_expiry_from_server");
}

/**
 * Check the stored license against the remote MySQL license server.
 * Returns { valid, reason? }. Use for startup and after entering a new key.
 */
export async function checkLicenseWithServer(): Promise<LicenseCheckResult> {
  try {
    return await invoke<LicenseCheckResult>("check_license_with_server");
  } catch (error) {
    console.error("Error checking license with server:", error);
    return { valid: false, reason: "invalid" };
  }
}

/**
 * Check a license key against the server (key as argument, not from keyring). Use on activation before storing.
 */
export async function checkLicenseKeyWithServer(licenseKey: string): Promise<LicenseCheckResult> {
  try {
    return await invoke<LicenseCheckResult>("check_license_key_with_server", { licenseKey });
  } catch (error) {
    console.error("Error checking license key with server:", error);
    return { valid: false, reason: "invalid" };
  }
}

/**
 * Check if a valid license exists: local validation and remote server check (expiry).
 * On startup, use this; if false, show License screen (or expired message).
 */
export async function isLicenseValid(): Promise<boolean> {
  try {
    const storedKey = await getLicenseKey();
    if (!storedKey) {
      return false;
    }
    const localValid = await validateLicenseKey(storedKey);
    if (!localValid) {
      return false;
    }
    const serverResult = await checkLicenseWithServer();
    return serverResult.valid;
  } catch (error) {
    console.error("Error checking license validity:", error);
    return false;
  }
}
