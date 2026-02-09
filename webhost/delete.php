<?php
require_once __DIR__ . '/auth.php';
webhost_require_superadmin();
require_once __DIR__ . '/db.php';

$id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
if ($id <= 0) {
    header('Location: index.php?error=Invalid+id');
    exit;
}

$pdo = license_pdo();
$table = license_table();
$stmt = $pdo->prepare("DELETE FROM `$table` WHERE id = ?");
$stmt->execute([$id]);
header('Location: index.php?deleted=1');
exit;
