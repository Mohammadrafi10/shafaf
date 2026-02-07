<?php
/**
 * License DB connection and table ensure.
 */
require_once __DIR__ . '/license_crypto.php';

function license_db_config() {
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/config.php';
    }
    return $config;
}

function license_pdo() {
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $c = license_db_config();
    $dsn = sprintf(
        'mysql:host=%s;port=%s;charset=utf8mb4',
        $c['db_host'],
        $c['db_port']
    );
    $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $db = $c['db_name'];
    $pdo->exec("CREATE DATABASE IF NOT EXISTS `" . str_replace('`', '``', $db) . "`");
    $pdo->exec("USE `" . str_replace('`', '``', $db) . "`");
    $table = $c['table'];
    $pdo->exec("CREATE TABLE IF NOT EXISTS `$table` (
        id INT PRIMARY KEY AUTO_INCREMENT,
        license_key VARCHAR(255) NOT NULL UNIQUE,
        expires_at_encrypted TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )");
    return $pdo;
}

function license_table() {
    return license_db_config()['table'];
}
