<?PHP
declare(strict_types=1);
namespace ked;

class ACL {
    function __construct (high $ked)
    {
        $this->ked = $ked;
        $this->configuration = [
            'default' => [
                'access'
            ],
            'ownobject' => [
                'access'
            ]
        ];
    }

    function setConfiguration(array $conf)
    {
        foreach ($conf as $k => $v) {
            $value = [];
            $negated = [];
            if (is_array($v)) {
                foreach ($v as $aclOrShortcut) {
                    if ($aclOrShortcut[0] === '-') {
                        $negated = array_merge($negated, $this->aclFromShortcut(substr($aclOrShortcut, 1)));
                        continue;
                    }
                    $value = array_merge($value, $this->aclFromShortcut($aclOrShortcut));
                }
            } else if (is_string($v)) {
                if ($v[0] === '-') {
                    $negated = array_merge($negated, $this->aclFromShortcut(substr($v, 1)));
                    continue;
                }
                $value = $this->aclFromShortcut($v);
            } else {
                continue;
            }
            foreach ($negated as $n) {
                do {
                    $k = array_search($n, $value);
                    if ($k !== false) {
                        unset($value[$k]);
                    }
                } while ($k !== false); // some value might be added several time, suppress them all
            }
            $this->configuration[$k] = $value;
        }
    }

    function aclFromShortcut (string $shortcut):array {
        switch ($shortcut) {
            case 'write':
            case 'everything':
                return [
                    'list',
                    'access',
                    'create',
                    'create:sub',
                    'create:entry',
                    'delete',
                    'undelete',
                    'tag',
                    'untag',
                    'archive',
                    'unarchive'
                ];
            case 'tagging':
                return [
                    'tag',
                    'untag'
                ];
            case 'read':
                return [
                    'access'
                ];
        }
        return [$shortcut];
    }

    function parseACLString (string $aclString) {
        $parts = explode(' ', $aclString);
        $acls = [];

        foreach ($parts as $term) {
            if (empty($term)) { continue; }
            $negated = false;
            if ($term[0] === '-') {
                $negated = true;
                $term = substr($term, 1);
            }
            $effective = $this->aclFromShortcut($term);
            if ($negated) {
                foreach ($effective as &$e) {
                    $e = '-' . $e;
                }
            }
            $acls = array_merge($acls, $effective);
        }
        return $acls;
    }

    function solveACLs ($acls) {
        $solved = [];
        foreach ($acls as $acl) {
            if ($acl[0] === '-') { continue; }
            if (!in_array($acl, $solved)) {
                $solved[] = $acl;
            }
        }
        foreach ($acls as $acl) {
            if ($acl[0] !== '-') { continue; }
            $acl = substr($acl, 1);
            $index = array_search($acl, $solved);
            if ($index !== false) {
                unset($solved[$index]);
            }
        }
        return $solved;
    }

    function lookupUser (string $user) {
        /* is an uid ? */
        $userObject = $this->ked->getUserByUid($user);
        if ($userObject) { return $userObject; }
    
        /* is a group ? */
        $conn = $this->ked->getLdapConn();
        $res = ldap_read(
            $conn,
            $user,
            '(objectclass=*)',
            [
                'member',
                'uniqueMember',
                'kedAclMember',
                'kedUser'
            ]
        );
        if ($res) {
            $entry = @ldap_first_entry($conn, $res);
            if ($entry) {
                $users = [];
                for ($attr = ldap_first_attribute($conn, $entry); $attr; $attr = ldap_next_attribute($conn, $entry)) {
                    $value = @ldap_get_values($conn, $entry, $attr);
                    if ($value) {
                        for($i = 0; $i < $value['count']; $i++) {
                            switch($attr) {
                                case 'member':
                                    $user = $this->ked->getUserByUid($value[$i]);
                                    if ($user) {
                                        $users[] = $user;
                                    }        
                                    break;
                                default:
                                    $user = $this->ked->getUserByDbId($value[$i]);
                                    if ($user) {
                                        $users[] = $user;
                                    }
                            }
                        }
                    }
                }
                if (!empty($users)) {
                    return $users;
                }
            }
        }

        /* nothing */
       return false;
    }

    function getACLObjectsForTag (string $tagDn):array {
        $conn = $this->ked->getLdapConn();
        $res = @ldap_list(
            $conn,
            $this->ked->getAclBase(),
            '(kedRelatedTag=' . ldap_escape($tagDn, '', LDAP_ESCAPE_FILTER) . ')',
            [ '*' ]
        );
        if (!$res) { return []; }
        $aclObjects = [];
        for ($entry = ldap_first_entry($conn, $res); $entry; $entry = ldap_next_entry($conn, $entry)) {
            $object = $this->ked->getRawLdapObject($conn, $entry);
            if ($object) {
                if (isset($object['kedaclmember'])) {
                    $aclMembers = [];
                    foreach ($object['kedaclmember'] as $v) {
                        $user = $this->ked->getUserByDbId($v);
                        if (!$user) {
                            $user = $this->lookupUser($v);
                        }
                        if ($user) {
                            if (is_array($user)) {
                                $aclMembers = array_merge($aclMembers, $user);
                            } else {
                                $aclMembers[] = $user;
                            }
                        }
                    }
                    $object['kedaclmember'] = $aclMembers;
                    $aclObjects[] = $object;
                }
            }
        }
        return $aclObjects;
    }

    function canRoot ($user, string $access) {
        $aclObjects = $this->getACLObjectsForTag($this->ked->getDocumentBase());
        if (empty($aclObjects)) { return false; }

        $acls = [];
        foreach($aclObjects as $aclObject) {
            foreach($aclObject['kedaclmember'] as $member) {
                if (!isset($aclObject['kedaclmember'])) { return false; }

                if ($member->getUid() === $user->getUid()) {
                    foreach($aclObject['kedaclright'] as $acl) {
                        $acls = array_merge($acls, $this->parseACLString($acl));
                    }
                }
            }
        }
        if (!empty($acls)) {
            $acls = $this->solveACLs($acls);
            return in_array($access, $acls);
        }
        return false;
    }

    /*
     * $ACL->can('user', 'access', 'document')
     * $ACL->can('user', 'update', 'document')
     * ... 
     */
    function can ($user, string $access, string $objectDn):bool {
        $ownObject = false;
        $nothingSet = true;


        /* root is checked differently */
        if ($objectDn === $this->ked->getDocumentBase()) {
            return $this->canRoot($user, $access);
        }

        /* check owner role */
        $users = $this->ked->getObjectUsersObjects($objectDn);
        foreach ($users as $u) {
            $nothingSet = false; // users are set, so something set
            if ($u->getUid() === $user->getUid()) {
                $ownObject = true;
                break;
            }
        }

        /* check ownobject rules. user set in object attributes obey to this first */
        if ($ownObject && in_array($access, $this->configuration['ownobject'])) {
            return true;
        }

        $tags = $this->ked->getRelatedTags($objectDn);
        $acls = [];
        foreach ($tags as $k => $v) {
            $aclObjects = $this->getACLObjectsForTag($k);
            if (empty($aclObjects)) { continue; }
            foreach ($aclObjects as $aclObject) {
                if (!isset($aclObject['kedaclmember'])) { continue; }
                foreach($aclObject['kedaclmember'] as $member) {
                    if ($member->getUid() === $user->getUid()) {
                        $nothingSet = false;
                        foreach($aclObject['kedaclright'] as $acl) {
                            $acls = array_merge($acls, $this->parseACLString($acl));
                        }
                    }
                }
            }
        }

        if (!empty($acls)) {
            $acls = $this->solveACLs($acls);
            return in_array($access, $acls);
        }

        if ($nothingSet) {
            return in_array($access, $this->configuration['default']);
        }
        return false;
    }
}