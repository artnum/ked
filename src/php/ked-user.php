<?PHP
declare(strict_types=1);
namespace ked;

class User {
    function __construct(ked $ked, \Menshen\User $user, string $dn = '') {
        $this->ked = $ked;
        $this->user = $user;
        if ($dn !== '') {
            $this->dn = $dn;
        } else {
            $this->dn = $this->findUserDn($this->user);
        }
    }

    static function fromDN (ked $ked, string $dn):?User {
        $conn = $ked->getLdapConn();

        /* if we can't explode a dn, it's not a dn */
        if (ldap_explode_dn($dn, 1) === false) { return null; }

        /* exclude groups */
        $res = @ldap_read(
            $conn,
            $dn,
            '(&(!(kedUser=*))(!(memberUid=*))(!(uniqueMember=*))(!(kedAclMember=*)))', 
            [
                'uid',
                'mail'
            ]
        );
        if (!$res) { return null; }
        $entry = @ldap_first_entry($conn, $res);
        if (!$entry) { return null; }
        for ($attr = @ldap_first_attribute($conn, $entry); $attr; $attr = @ldap_next_attribute($conn, $entry)) {
            $values = @ldap_get_values($conn, $entry, $attr);
            if (!$values) { continue; }
            if ($values['count'] <= 0) { continue; }
            /* any value that find a user is the right one */
            for ($i = 0; $i < $values['count']; $i++) {
                $user = $ked->getUserByUid($values[$i]);
                if ($user) { return new User($ked, $user, $dn); }
            }
        }

        return null;
    }

    function getDn () {
        return $this->dn;
    }

    function getDisplayName () {
        return $this->user->getDisplayName();
    }

    function getDbId () {
        return $this->user->getDbId();
    }

    function getUid() {
        return $this->user->getUid();
    }

    function toJson() {
        return $this->user->toJson();
    }

    function findUserDn (\Menshen\User $user) {
        $conn = $this->ked->getLdapConn();
        /* db id is a dn */
        $res = ldap_read($conn, $user->getDbId(), '(objectclass=*)', ['dn']);
        if ($res) {
            $entry = ldap_first_entry($conn, $res);
            if ($entry) {
                $dn = ldap_get_dn($conn, $entry);
                if ($dn) { return $dn; }
            }
        }

        /* try glue record with uid */
        $dn = $this->userHasGlueRecord($user->getUid());
        if ($dn !== '') { return $dn; }

        /* try glue record with db id */
        $dn = $this->userHasGlueRecord($user->getDbId());
        if ($dn !== '') { return $dn; }

        return '';
    }

    function userHasGlueRecord (string $user) {
        $conn = $this->ked->getLdapConn();
        $uf = ldap_escape($user, '', LDAP_ESCAPE_FILTER);
        $filter = '(|(uid=' . $uf . ')(mail=' . $uf . '))';
        $res = ldap_search(
            $conn,
            $this->ked->getBase(),
            $filter,
            [
                'dn'
            ],
            0,
            1 // we only want 1 result
        );
        if (!$res) { return ''; }
        $entry = ldap_first_entry($conn, $res);
        if (!$entry) { return ''; }
        $dn = ldap_get_dn($conn, $entry);
        if (!$dn) { return ''; }
        return $dn;
    }
}