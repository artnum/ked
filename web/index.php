<?PHP

use ked\high;
use ked\http;
use ked\msg;

require('conf/ked.php');
require('../src/php/ked.php');
require('../src/php/ked-high.php');
require('../src/php/http.php');
require('../src/php/msg.php');
require('../../Menshen/php/Menshen.php');

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

$high = new high(
    $ldap,
    $KEDConfiguration['ldap'][0]['base']
);
if (!$high->init()) {
    exit('Init failed');
}
$high->setStore(
    $KEDConfiguration['store'][0]['path']
);
$high->setMaxTextSize(
    $KEDConfiguration['store'][0]['max-text-size']
);
$high->disableInlinePicture();

$credStore = new \Menshen\LDAPStore(
    $ldap,
    $KEDConfiguration['ldap'][0]['base']
);
$menshen = new \Menshen($credStore);

if (($user = $menshen->check()) !== false) {
    $msg = new msg(
        $KEDConfiguration['message'][0]['address'],
        $KEDConfiguration['message'][0]['port'],
        $KEDConfiguration['message'][0]['key']
    );
    $http = new http($high, $msg);
    $http->setAclConfiguration($KEDConfiguration['acl']);
    $http->setUser($user);
    $http->setUserStore($credStore);
    $http->run();
} else {
    http_response_code(403);
}
ldap_unbind($ldap);
?>