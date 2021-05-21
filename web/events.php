<?php

require('../src/php/msg.php');

ignore_user_abort(true);
header('Cache-Control: no-cache', true);
header('Content-Type: text/event-stream', true);

function error() {
    echo "event: error\n\n";
    ob_flush();
    flush();
}

$socket = @socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
if (!$socket) { error(); exit(0); }
if (!@socket_connect($socket, '127.0.0.1', 8531)) { error(); exit(0); }
socket_set_nonblock($socket);

$msgAuth = new ked\msgAuth('ked-demo-key');

echo "event: hello\ndata: {\"hello\": \"world\"};\n\n";
ob_flush();
flush();

$ping = 0;
$pingCnt = 0;
$exit = false;
do {
    $message = socket_read($socket, 256);
    if ($message === '' || $message === false) {
        $code = socket_last_error($socket);
        socket_clear_error($socket);
        switch($code) {
            case SOCKET_EAGAIN: break;
            default: $exit = true; break;
        }
    } else {
        $payload = $msgAuth->verify($message);
        if ($payload) {
            if ($payload === 'exit') { $exit = true; }
            else {
                $parts = explode(':', $payload, 2);
                if (count($parts) !== 2) { $exit = true; }
                else {
                    printf('event: %s' . PHP_EOL . 'data: {"id": "%s"}' . PHP_EOL . PHP_EOL, $parts[0], $parts[1]);
                }
            }
        }
    }
    ob_flush();
    flush();
    if (connection_status() !== 0) { $exit = true; }
    $ping++;
    if ($ping > 30) {
        $pingCnt++;
        $ping = 0;
        printf('event: ping' . PHP_EOL . 'data: {"id": "%s"}' . PHP_EOL . PHP_EOL, $pingCnt);

    }
    sleep(1);
} while(!$exit);

socket_write($socket, $msgAuth->sign('exit'));
socket_close($socket);
