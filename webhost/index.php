<?php
require_once __DIR__ . '/db.php';

$pdo = license_pdo();
$table = license_table();
$stmt = $pdo->query("SELECT id, license_key, expires_at_encrypted, created_at FROM `$table` ORDER BY id");
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

foreach ($rows as &$r) {
    $r['expires_at_decrypted'] = license_decrypt_expiry($r['expires_at_encrypted']);
}
unset($r);

$message = '';
$isError = false;
if (isset($_GET['deleted'])) {
    $message = 'License deleted.';
}
if (isset($_GET['created'])) {
    $message = 'License created.';
}
if (isset($_GET['updated'])) {
    $message = 'License updated.';
}
if (isset($_GET['error'])) {
    $message = 'Error: ' . htmlspecialchars($_GET['error']);
    $isError = true;
}
?>
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>License management</title>
    <link rel="stylesheet" href="assets/css/app.css">
</head>
<body>
    <div class="app">
        <header class="page-header">
            <h1 class="page-title">License management</h1>
            <a href="create.php" class="btn btn--primary">Add license</a>
        </header>

        <?php if ($message): ?>
            <div class="alert alert--<?php echo $isError ? 'error' : 'success'; ?>"><?php echo htmlspecialchars($message); ?></div>
        <?php endif; ?>

        <div class="card">
            <?php if (empty($rows)): ?>
                <div class="empty">No licenses yet. <a href="create.php">Add one</a>.</div>
            <?php else: ?>
                <div class="table-wrap">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>License key</th>
                                <th>Expires at</th>
                                <th>Created</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($rows as $row): ?>
                                <tr>
                                    <td class="num"><?php echo (int)$row['id']; ?></td>
                                    <td><code><?php echo htmlspecialchars($row['license_key']); ?></code></td>
                                    <td class="num"><?php echo $row['expires_at_decrypted'] !== null ? htmlspecialchars($row['expires_at_decrypted']) : '<span class="expiry-fail">(decrypt failed)</span>'; ?></td>
                                    <td class="num"><?php echo htmlspecialchars($row['created_at']); ?></td>
                                    <td class="cell-actions">
                                        <a href="update.php?id=<?php echo (int)$row['id']; ?>" class="btn btn--secondary btn--sm">Edit</a>
                                        <a href="delete.php?id=<?php echo (int)$row['id']; ?>" class="btn btn--danger btn--sm" onclick="return confirm('Delete this license?');">Delete</a>
                                    </td>
                                </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            <?php endif; ?>
        </div>
    </div>
</body>
</html>
