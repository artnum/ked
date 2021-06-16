<?php
require('../web/conf/ked.php');
require('../src/php/msg.php');
pcntl_async_signals(true);

$socket = socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
if (!$socket) { die('error socket creation'); }
if (!
    socket_bind(
        $socket, 
        $KEDConfiguration['message'][0]['address'],
        $KEDConfiguration['message'][0]['port']
    )
) { die('error socket bind'); }
socket_listen($socket);

$msgSocket = socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
if (!$msgSocket) { die('error socket creation'); }
if (!
    socket_bind(
        $msgSocket,
        $KEDConfiguration['message'][0]['address'],
        $KEDConfiguration['message'][0]['port']
    )
) { die ('error msg socket bind'); }

$msgAuth = new ked\msgAuth($KEDConfiguration['message'][0]['key']);

$exit = false;
$clients = [];

function _do_exit() { 
    global $exit; 
    $exit = true; 
}

pcntl_signal(SIGTERM, '_do_exit');
pcntl_signal(SIGINT, '_do_exit');

do {
    $read = array_merge([$socket, $msgSocket], $clients);
    $n = null;

    if (@socket_select($read, $n, $n, null) < 1) { continue; }
    foreach ($read as $sock) {
        /* accept new client */
        if ($sock === $socket) {
            $new_client = socket_accept($socket);
            if ($new_client) { 
                socket_set_nonblock($new_client);
                $clients[] = $new_client; 
            }
        }

        /* transmit message further */
        if ($sock === $msgSocket) {
            $data = socket_read($msgSocket, 256);
            $payload = $msgAuth->verify($data);
            if ($payload) {
                foreach ($clients as $k => $client) {
                    if (@socket_write($client, $data . "\n") === false) {
                        socket_shutdown($client);
                        socket_close($client);
                        unset($clients[$k]);
                    }
                }
            }
        }

        if (($k = array_search($sock, $clients, true)) !== false) {
            $data = socket_read($sock, 256);
            if (!($data === false || $data === '')) {
                $payload = $msgAuth->verify($data);
                if ($payload === 'exit')  {
                    socket_shutdown($sock);
                    socket_close($sock);
                    unset($clients[$k]);
                }
            }
            if ($data === false || $data === 0 || $data === '') {
                socket_shutdown($sock);
                socket_close($sock);
                unset($clients[$k]);
            }
        }
    }
} while(!$exit);

foreach ($clients as $client) {
    @socket_write($client, $msgAuth->sign('exit'));
}

socket_shutdown($socket);
socket_close($socket);
socket_close($msgSocket);