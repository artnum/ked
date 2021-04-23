<?PHP

use ked\high;
use ked\http;

include ('../src/php/ked.php');
include ('../src/php/ked-high.php');
include ('../src/php/http.php');

$ldap = ldap_connect('ldap://127.0.0.1:9090/');
ldap_set_option($ldap, LDAP_OPT_PROTOCOL_VERSION, 3);
ldap_bind($ldap, 'cn=admin,o=ked', '1234');


$high = new high($ldap, 'o=ked');
$high->setStore('/tmp/');
$high->setMaxTextSize(4096);
$high->disableInlinePicture();

$http = new http($high);
$http->run();
ldap_unbind($ldap);
?>