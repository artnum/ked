<?PHP

use artnum\Auth\Menshen;
use ked\high;
use ked\http;
use ked\msg;

include ('../src/php/ked.php');
include ('../src/php/ked-high.php');
include ('../src/php/http.php');
include ('../src/php/msg.php');
include ('../../Menshen/php/Menshen.php');

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

$credStore = new \Menshen\LDAPStore($ldap, 'o=artnum');
$menshen = new \Menshen($credStore);
if (($user = $menshen->check()) !== false) {
    $msg = new msg();
    $http = new http($high, $msg);
    $http->setUser($user);
    $http->run();
} else {
    http_response_code(403);
}
ldap_unbind($ldap);
?>