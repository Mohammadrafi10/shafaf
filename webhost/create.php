<?php
require_once __DIR__ . '/auth.php';
webhost_require_superadmin();
require_once __DIR__ . '/db.php';

$error = '';
$done = false;

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $key = trim((string)($_POST['license_key'] ?? ''));
    $expiry = trim((string)($_POST['expires_at'] ?? ''));

    if ($key === '') {
        $error = 'License key is required.';
    } elseif ($expiry === '') {
        $error = 'Expiry datetime is required.';
    } else {
        $encrypted = license_encrypt_expiry($expiry);
        if ($encrypted === null) {
            $error = 'Failed to encrypt expiry.';
        } else {
            try {
                $pdo = license_pdo();
                $table = license_table();
                $stmt = $pdo->prepare("INSERT INTO `$table` (license_key, expires_at_encrypted) VALUES (?, ?)");
                $stmt->execute([$key, $encrypted]);
                header('Location: index.php?created=1');
                exit;
            } catch (PDOException $e) {
                if ($e->getCode() == 23000) {
                    $error = 'License key already exists.';
                } else {
                    $error = $e->getMessage();
                }
            }
        }
    }
}

$license_key = isset($_POST['license_key']) ? htmlspecialchars($_POST['license_key']) : '';
$expires_at = isset($_POST['expires_at']) ? htmlspecialchars($_POST['expires_at']) : date('Y-m-d\TH:i:s');
?>
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Add license</title>
    <link rel="stylesheet" href="assets/css/app.css">
</head>
<body>
    <div class="app">
        <header class="page-header">
            <h1 class="page-title">Add license</h1>
            <a href="index.php" class="nav-back">← Back to list</a>
        </header>

        <?php if ($error): ?>
            <div class="alert alert--error"><?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>

        <div class="card form-card">
            <div class="card__body">
            <form method="post" action="create.php">
                <div class="form-group">
                    <label class="form-label" for="license_key">License key</label>
                    <input type="text" id="license_key" name="license_key" class="form-input" value="<?php echo $license_key; ?>" required placeholder="Encrypted machine ID (hex)">
                    <p class="form-hint">Use the value shown in the desktop app when activating (encrypted machine ID).</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="expires_at">Expires at</label>
                    <input type="text" id="expires_at" name="expires_at" class="form-input" value="<?php echo $expires_at; ?>" required placeholder="2026-12-31T23:59:59">
                    <p class="form-hint">Format: YYYY-MM-DDTHH:MM:SS (stored encrypted in DB).</p>
                </div>
                <div class="form-actions">
                    <button type="submit" class="btn btn--primary">Create</button>
                    <a href="index.php" class="btn btn--secondary">Cancel</a>
                </div>
            </form>
            </div>
        </div>
    </div>
</body>
</html>
