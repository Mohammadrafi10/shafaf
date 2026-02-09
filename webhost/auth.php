<?php
/**
 * Superadmin auth for webhost: single password from .env.
 * Include this first on every protected page.
 */
if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$webhostDir = __DIR__;
$envPath = $webhostDir . '/.env';

function webhost_load_env($envPath) {
    if (!is_file($envPath)) {
        return;
    }
    $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || strpos($line, '#') === 0) {
            continue;
        }
        if (strpos($line, '=') !== false) {
            list($key, $value) = explode('=', $line, 2);
            $key = trim($key);
            $value = trim($value, " \t\"'");
            $_ENV[$key] = $value;
            if (!getenv($key)) {
                putenv("$key=$value");
            }
        }
    }
}

webhost_load_env($envPath);

function webhost_superadmin_password() {
    return getenv('SUPERADMIN_PASSWORD') ?: ($_ENV['SUPERADMIN_PASSWORD'] ?? '');
}

function webhost_require_superadmin() {
    $expected = webhost_superadmin_password();
    if ($expected === '') {
        header('Content-Type: text/html; charset=utf-8');
        echo '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Setup</title></head><body>';
        echo '<p>Superadmin is not configured. Create <code>webhost/.env</code> with <code>SUPERADMIN_PASSWORD=your-secret</code> (see .env.example).</p>';
        echo '</body></html>';
        exit;
    }

    if (!empty($_SESSION['webhost_superadmin'])) {
        return;
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['password'])) {
        if (hash_equals($expected, (string)$_POST['password'])) {
            $_SESSION['webhost_superadmin'] = true;
            header('Location: ' . (isset($_GET['redirect']) ? $_GET['redirect'] : 'index.php'));
            exit;
        }
    }

    header('Content-Type: text/html; charset=utf-8');
    ?>
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Superadmin login</title>
    <link rel="stylesheet" href="assets/css/app.css">
</head>
<body>
    <div class="app">
        <div class="card form-card" style="max-width: 360px; margin: 2rem auto;">
            <div class="card__body">
                <h2 class="page-title" style="margin-top: 0;">License admin</h2>
                <?php if (!empty($_POST['password'])): ?>
                    <div class="alert alert--error">Invalid password.</div>
                <?php endif; ?>
                <form method="post" action="<?php echo htmlspecialchars($_SERVER['REQUEST_URI']); ?>">
                    <div class="form-group">
                        <label class="form-label" for="password">Password</label>
                        <input type="password" id="password" name="password" class="form-input" required autofocus>
                    </div>
                    <div class="form-actions">
                        <button type="submit" class="btn btn--primary">Log in</button>
                    </div>
                </form>
            </div>
        </div>
    </div>
</body>
</html>
    <?php
    exit;
}
