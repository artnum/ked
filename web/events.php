<?php

require('conf/ked.php');
require('../src/php/ked-state.php');
require('../src/php/msg.php');
require('../../Menshen/php/Menshen.php');

function get_client_ip() {
    foreach (['HTTP_CLIENT_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_FORWARDED', 'HTTP_X_CLUSTER_CLIENT_IP', 'HTTP_FORWARDED_FOR', 'HTTP_FORWARDED', 'REMOTE_ADDR']as $k){
        if (!empty($_SERVER[$k])) {
            $ips = explode(',', $_SERVER[$k]);
            return trim($ips[0]);
        }
    }
}

$ldap = ldap_connect(
    $KEDConfiguration['ldap'][0]['uri']
);
ldap_set_option($ldap, LDAP_OPT_PROTOCOL_VERSION, 3);
ldap_bind(
    $ldap,
    $KEDConfiguration['ldap'][0]['creds']['user'],
    $KEDConfiguration['ldap'][0]['creds']['password']
);

$state = new ked\state(
    $KEDConfiguration['ldap'][0]['base'], 
    $ldap
);
$credStore = new \Menshen\LDAPStore(
    $ldap,
    $KEDConfiguration['ldap'][0]['base']
);
$menshen = new \Menshen($credStore);

ignore_user_abort(true);
header('Cache-Control: no-cache', true);
header('Content-Type: text/event-stream', true);

if (!($user = $menshen->check())) { error(); exit(); }

$clientid = $_REQUEST['clientid'];
$state->connection($_REQUEST['clientid'], $user->getDbId(), get_client_ip());

function error() {
    echo "event: error\n\n";
    ob_flush();
    flush();
}

$socket = @socket_create(AF_INET, SOCK_STREAM, SOL_TCP);
if (!$socket) { error(); exit(0); }
if (!
    @socket_connect(
        $socket, 
        $KEDConfiguration['message'][0]['address'],
        $KEDConfiguration['message'][0]['port']
    )
) { error(); exit(0); }
socket_set_nonblock($socket);

$msgAuth = new ked\msgAuth($KEDConfiguration['message'][0]['key']);

echo "event: hello\ndata: {\"hello\": \"world\"};\n\n";
ob_flush();
flush();

$ping = 0;
$pingCnt = 0;
$exit = false;
$rest = '';
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
        if ($rest) {
            $message = $rest . $message;
            $rest = '';
        }
        do {
            $end = strpos($message, "\n");
            $msg = substr($message, 0, $end);
            if ($end === strlen($message) - 1) { $rest = ''; $message = ''; }
            else {
                $message = substr($message, $end + 1);
            }
            $payload = $msgAuth->verify($msg);
            if ($payload) {
                if ($payload === 'exit') { $exit = true; }
                else {
                    $parts = explode(':', $payload, 2);
                    if (count($parts) !== 2) { $exit = true; }
                    else {
                        $subparts = explode('\\', $parts[1], 2);
                        if (count($subparts) !== 2) {
                            printf('event: %s' . PHP_EOL . 'data: {"id": "%s"}' . PHP_EOL . PHP_EOL, $parts[0], $parts[1]);
                        } else {
                            printf('event: %s' . PHP_EOL . 'data: {"id": "%s", "clientid": "%s"}' . PHP_EOL . PHP_EOL, $parts[0], $subparts[0], $subparts[1]);
                        }
                    }
                }
            }
        } while(strpos($message, "\n") !== false);
        if (strlen($message) > 0) {
            $rest = $message;
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

$state->disconnection($clientid);

socket_write($socket, $msgAuth->sign('exit'));
socket_close($socket);
