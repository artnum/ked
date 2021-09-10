<?php

require('conf/ked.php');
require('../src/php/ked-state.php');
require('../src/php/msg.php');
require('../../Menshen/php/Menshen.php');
require('wesrv/lib/client.php');

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

if (!($user = $menshen->check())) { exit(); }

$clientid = $_REQUEST['clientid'];
$state->connection($_REQUEST['clientid'], $user->getDbId(), get_client_ip());

$client = new \wesrv\client();
$client->run();

$state->disconnection($clientid);