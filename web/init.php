<?php

if (!defined('KED')) { exit(0); }

use ked\high;

require('conf/ked.php');
require('../src/php/ked.php');
require('../src/php/ked-high.php');
require('../src/php/http.php');
require('../src/php/msg.php');
require('../../Menshen/php/Menshen.php');

error_log('init');
header('Content-Type: text/plain'); // start with text plain

$ldap = ldap_connect(
    $KEDConfiguration['ldap'][0]['uri']
);
ldap_set_option($ldap, LDAP_OPT_PROTOCOL_VERSION, 3);
ldap_bind(
    $ldap,
    $KEDConfiguration['ldap'][0]['creds']['user'],
    $KEDConfiguration['ldap'][0]['creds']['password']
);

$KEDHigh = new high(
    $ldap,
    $KEDConfiguration['ldap'][0]['base']
);
if (!$KEDHigh->init()) {
    exit('Init failed');
}
$KEDHigh->setStore(
    $KEDConfiguration['store'][0]['path']
);
$KEDHigh->setMaxTextSize(
    $KEDConfiguration['store'][0]['max-text-size']
);
$KEDHigh->disableInlinePicture();