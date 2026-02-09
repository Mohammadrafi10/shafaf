<?php
session_start();
unset($_SESSION['webhost_superadmin']);
session_destroy();
header('Location: index.php');
exit;
