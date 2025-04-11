DROP DATABASE IF EXISTS `double_wheel`;
CREATE DATABASE IF NOT EXISTS `double_wheel`;
USE `double_wheel`;

CREATE TABLE IF NOT EXISTS `settlement`(
    id INT AUTO_INCREMENT PRIMARY KEY,
    match_id VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    operator_id VARCHAR(50) NOT NULL,
    bet_amount DECIMAL(10,2) NOT NULL,
    win_amount DECIMAL(10,2) NOT NULL,
    txn_id VARCHAR(50) UNIQUE NOT NULL,
    betdata TEXT NOT NULL,
    winning_bet DECIMAL(10,2) NOT NULL,
    result TEXT NOT NULL,
    status ENUM('win', 'lose') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);