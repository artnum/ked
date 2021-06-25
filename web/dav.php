<?php
exit(0); // disabled
include ('vendor/autoload.php');

use Sabre\DAV;
use ked\high;
use ked\KDirectory;

include ('../src/php/ked.php');
include ('../src/php/ked-high.php');
include ('../src/php/ked-sdav.php');

$ldap = ldap_connect('ldap://127.0.0.1:9090/');
ldap_set_option($ldap, LDAP_OPT_PROTOCOL_VERSION, 3);
ldap_bind($ldap, 'cn=admin,o=artnum', '1234');


$high = new high($ldap, 'o=artnum');
if (!$high->init()) { 
    exit( 'Init Failed');
}
$high->setStore('/tmp/');
$high->setMaxTextSize(4096);
$high->disableInlinePicture();

$root = new KDirectory($high, '');
$server = new DAV\Server($root);

$server->setBaseUri($_SERVER['SCRIPT_NAME']);
$server->exec();

ldap_unbind($ldap);
?>