<?PHP
define('KED', 1);
use ked\high;
use ked\http;
use ked\msg;

include('init.php');

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
    $http = new http($KEDHigh, $msg);
    $http->setAclConfiguration($KEDConfiguration['acl']);
    $http->setUser($user);
    $http->setUserStore($credStore);
    $http->run();
} else {
    http_response_code(403);
}
ldap_unbind($ldap);
?>