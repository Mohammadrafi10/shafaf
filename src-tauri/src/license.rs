use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use sha2::{Digest, Sha256};
use sysinfo::System;

// Secret key derived from app identifier
// In production, this should be obfuscated or derived from app metadata
const SECRET_KEY_BASE: &str = "com.sulaiman.financeapp.license.secret.2024";
const SALT: &str = "finance-app-salt-2024";
/// Salt for expiry datetime encryption (different from machine ID)
const EXPIRY_SALT: &str = "finance-app-expiry-salt-2024";

/// Derive encryption key from secret base
fn derive_key() -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(SECRET_KEY_BASE.as_bytes());
    hasher.update(SALT.as_bytes());
    let hash = hasher.finalize();
    let mut key = [0u8; 32];
    key.copy_from_slice(&hash[..32]);
    key
}

/// Generate a unique machine ID based on hardware information
pub fn generate_machine_id() -> String {
    let mut system = System::new();
    system.refresh_all();

    let mut components = Vec::new();

    // Get CPU information
    if let Some(cpu) = system.cpus().first() {
        components.push(format!("cpu:{}", cpu.brand()));
    }

    // Get system hostname (if available)
    if let Some(hostname) = System::host_name() {
        components.push(format!("host:{}", hostname));
    }

    // Get system name and kernel version (if available)
    if let Some(name) = System::name() {
        components.push(format!("sys:{}", name));
    }
    
    if let Some(kernel) = System::kernel_version() {
        components.push(format!("kernel:{}", kernel));
    }

    // Get total memory (as a stable identifier)
    components.push(format!("mem:{}", system.total_memory()));

    // Get number of CPUs (as additional identifier)
    components.push(format!("cpu_count:{}", system.cpus().len()));

    // Combine all components and hash
    let combined = components.join("|");
    let mut hasher = Sha256::new();
    hasher.update(combined.as_bytes());
    let hash = hasher.finalize();
    
    // Return first 32 characters of hex-encoded hash
    hex::encode(&hash[..16])
}

/// Encrypt machine ID using AES-256-GCM with deterministic nonce
/// The nonce is derived from the machine ID to ensure consistent encryption
pub fn encrypt_machine_id(machine_id: &str) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new(&key.into());
    
    // Derive nonce from machine ID for deterministic encryption
    // Use first 12 bytes of SHA256 hash of machine_id as nonce
    let mut hasher = Sha256::new();
    hasher.update(machine_id.as_bytes());
    hasher.update(SALT.as_bytes()); // Add salt for nonce derivation
    let nonce_hash = hasher.finalize();
    let nonce = Nonce::from_slice(&nonce_hash[..12]);
    
    // Encrypt the machine ID
    let ciphertext = cipher
        .encrypt(nonce, machine_id.as_bytes())
        .map_err(|e| format!("Encryption error: {}", e))?;
    
    // Combine nonce and ciphertext, then encode as hex
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    
    Ok(hex::encode(combined))
}

/// Derive nonce for expiry encryption (deterministic from plaintext for reproducibility)
fn derive_expiry_nonce(plaintext: &str) -> [u8; 12] {
    let mut hasher = Sha256::new();
    hasher.update(plaintext.as_bytes());
    hasher.update(EXPIRY_SALT.as_bytes());
    let hash = hasher.finalize();
    let mut nonce = [0u8; 12];
    nonce.copy_from_slice(&hash[..12]);
    nonce
}

/// Encrypt expiry datetime string (e.g. ISO format) for storage in license server DB.
/// Returns hex-encoded ciphertext (nonce + ciphertext).
pub fn encrypt_expiry_datetime(datetime_str: &str) -> Result<String, String> {
    let key = derive_key();
    let cipher = Aes256Gcm::new(&key.into());
    let nonce_arr = derive_expiry_nonce(datetime_str);
    let nonce = Nonce::from_slice(&nonce_arr);
    let ciphertext = cipher
        .encrypt(nonce, datetime_str.as_bytes())
        .map_err(|e| format!("Expiry encryption error: {}", e))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(hex::encode(combined))
}

/// Decrypt expiry datetime from hex-encoded ciphertext from license server.
/// Returns the expiry datetime string (e.g. ISO format).
pub fn decrypt_expiry_datetime(hex_ciphertext: &str) -> Result<String, String> {
    let bytes = hex::decode(hex_ciphertext).map_err(|e| format!("Invalid hex: {}", e))?;
    if bytes.len() < 12 {
        return Err("Ciphertext too short".to_string());
    }
    let key = derive_key();
    let cipher = Aes256Gcm::new(&key.into());
    let (nonce_slice, ciphertext) = bytes.split_at(12);
    let nonce = Nonce::from_slice(nonce_slice);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Expiry decryption error: {}", e))?;
    String::from_utf8(plaintext).map_err(|e| format!("Invalid UTF-8: {}", e))
}

/// Validate license key by encrypting current machine ID and comparing
pub fn validate_license_key(entered_key: &str) -> Result<bool, String> {
    // Get current machine ID
    let machine_id = generate_machine_id();
    
    // Encrypt current machine ID
    let encrypted = encrypt_machine_id(&machine_id)?;
    
    // Compare (case-insensitive)
    Ok(encrypted.to_lowercase() == entered_key.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_machine_id_consistency() {
        let id1 = generate_machine_id();
        let id2 = generate_machine_id();
        // Machine ID should be consistent within the same session
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_encryption_decryption() {
        let machine_id = generate_machine_id();
        let encrypted = encrypt_machine_id(&machine_id).unwrap();
        
        // Encrypt again and compare
        let encrypted2 = encrypt_machine_id(&machine_id).unwrap();
        // Note: Due to random nonce, encrypted values will differ
        // But validation should work
        assert!(validate_license_key(&encrypted).unwrap());
    }
}
