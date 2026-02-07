<?php
/**
 * License management webhost config.
 * Override these in config.local.php or set env for production.
 */
$config = [
    'db_host' => getenv('LICENSE_DB_HOST') ?: '76.13.42.156',
    'db_port' => (int)(getenv('LICENSE_DB_PORT') ?: '3306'),
    'db_user' => getenv('LICENSE_DB_USER') ?: 'usershafaf',
    'db_pass' => getenv('LICENSE_DB_PASS') ?: '123',
    'db_name' => getenv('LICENSE_DB_NAME') ?: 'shafaf_license',
    'table'   => 'licenses',
];

if (is_file(__DIR__ . '/config.local.php')) {
    $config = array_merge($config, require __DIR__ . '/config.local.php');
}

return $config;
