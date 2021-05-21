<?PHP

use ked\high;
use ked\http;
use ked\msg;

include ('../src/php/ked.php');
include ('../src/php/ked-high.php');
include ('../src/php/http.php');
include ('../src/php/msg.php');

$ldap = ldap_connect('ldap://127.0.0.1:9090/');
ldap_set_option($ldap, LDAP_OPT_PROTOCOL_VERSION, 3);
ldap_bind($ldap, 'cn=admin,o=artnum', '1234');


$high = new high($ldap, 'o=artnum');
if (!$high->init()) {
    exit('Init failed');
}
$high->setStore('/tmp/');
$high->setMaxTextSize(4096);
$high->disableInlinePicture();

$msg = new msg();
$http = new http($high, $msg);
$http->run();
ldap_unbind($ldap);
?>