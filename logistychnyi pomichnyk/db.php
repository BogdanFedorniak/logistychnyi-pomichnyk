<?php
$host = 'localhost';
$db   = 'rio_trans';
$user = 'root';
$pass = '';        // Якщо ти ставив пароль для root — напиши його тут

try {
    $pdo = new PDO("mysql:host=$host;dbname=$db;charset=utf8mb4", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Помилка підключення до бази даних: ' . $e->getMessage()]);
    exit;
}
?>