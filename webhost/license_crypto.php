<?php
/**
 * Encrypt/decrypt expiry datetime for license server.
 * Must match src-tauri/src/license.rs (derive_key, derive_expiry_nonce, AES-256-GCM).
 */

define('LICENSE_SECRET_KEY_BASE', 'com.sulaiman.financeapp.license.secret.2024');
define('LICENSE_SALT', 'finance-app-salt-2024');
define('LICENSE_EXPIRY_SALT', 'finance-app-expiry-salt-2024');

function license_derive_key() {
    $h = hash('sha256', LICENSE_SECRET_KEY_BASE . LICENSE_SALT, true);
    return substr($h, 0, 32);
}

function license_derive_expiry_nonce($plaintext) {
    $h = hash('sha256', $plaintext . LICENSE_EXPIRY_SALT, true);
    return substr($h, 0, 12);
}

/**
 * Encrypt expiry datetime string for DB storage.
 * Returns hex string: nonce (12) + ciphertext + tag (16).
 */
function license_encrypt_expiry($datetimeStr) {
    $key = license_derive_key();
    $iv = license_derive_expiry_nonce($datetimeStr);
    $tag = '';
    $encrypted = openssl_encrypt(
        $datetimeStr,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag,
        '',
        16
    );
    if ($encrypted === false || strlen($tag) !== 16) {
        return null;
    }
    return bin2hex($iv . $encrypted . $tag);
}

/**
 * Decrypt expiry from hex ciphertext from DB.
 * Returns plain datetime string or null on failure.
 */
function license_decrypt_expiry($hexCiphertext) {
    $raw = hex2bin($hexCiphertext);
    if ($raw === false || strlen($raw) < 12 + 16) {
        return null;
    }
    $key = license_derive_key();
    $iv = substr($raw, 0, 12);
    $tag = substr($raw, -16);
    $ciphertext = substr($raw, 12, -16);
    $decrypted = openssl_decrypt(
        $ciphertext,
        'aes-256-gcm',
        $key,
        OPENSSL_RAW_DATA,
        $iv,
        $tag
    );
    return $decrypted !== false ? $decrypted : null;
}
