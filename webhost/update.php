<?php
require_once __DIR__ . '/db.php';

$id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
if ($id <= 0) {
    header('Location: index.php?error=Invalid+id');
    exit;
}

$pdo = license_pdo();
$table = license_table();
$stmt = $pdo->prepare("SELECT id, license_key, expires_at_encrypted, created_at FROM `$table` WHERE id = ?");
$stmt->execute([$id]);
$row = $stmt->fetch(PDO::FETCH_ASSOC);
if (!$row) {
    header('Location: index.php?error=License+not+found');
    exit;
}

$decrypted = license_decrypt_expiry($row['expires_at_encrypted']);
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $expiry = trim((string)($_POST['expires_at'] ?? ''));
    if ($expiry === '') {
        $error = 'Expiry datetime is required.';
    } else {
        $encrypted = license_encrypt_expiry($expiry);
        if ($encrypted === null) {
            $error = 'Failed to encrypt expiry.';
        } else {
            try {
                $up = $pdo->prepare("UPDATE `$table` SET expires_at_encrypted = ? WHERE id = ?");
                $up->execute([$encrypted, $id]);
                header('Location: index.php?updated=1');
                exit;
            } catch (PDOException $e) {
                $error = $e->getMessage();
            }
        }
    }
}

$expires_at = isset($_POST['expires_at']) ? htmlspecialchars($_POST['expires_at']) : ($decrypted ?? '');
?>
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Edit license</title>
    <link rel="stylesheet" href="assets/css/app.css">
</head>
<body>
    <div class="app">
        <header class="page-header">
            <h1 class="page-title">Edit license #<?php echo (int)$row['id']; ?></h1>
            <a href="index.php" class="nav-back">← Back to list</a>
        </header>

        <?php if ($error): ?>
            <div class="alert alert--error"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>

        <div class="card form-card">
            <div class="card__body">
            <form method="post" action="update.php?id=<?php echo $id; ?>">
                <div class="form-group">
                    <label class="form-label">License key</label>
                    <input type="text" value="<?php echo htmlspecialchars($row['license_key']); ?>" class="form-input" readonly>
                    <p class="form-hint">Key cannot be changed. Edit expiry only.</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="expires_at">Expires at</label>
                    <input type="text" id="expires_at" name="expires_at" class="form-input" value="<?php echo $expires_at; ?>" required placeholder="2026-12-31T23:59:59">
                    <p class="form-hint">Format: YYYY-MM-DDTHH:MM:SS. Stored encrypted in DB.</p>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn--primary">Update</button>
                    <a href="index.php" class="btn btn--secondary">Cancel</a>
                </div>
            </form>
            </div>
        </div>
    </div>
</body>
</html>
