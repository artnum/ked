<?PHP
declare(strict_types=1);
namespace ked;

class ACL {
    function __construct (high $ked)
    {
        $this->ked = $ked;
    }

    /*
     * $ACL->can('user', 'access', 'document')
     * $ACL->can('user', 'update', 'document')
     * ... 
     */
    function can (string $userDn, string $access, string $objectDn):bool {
        $object = $this->ked->getRawLdapObjectByDn($objectDn);
        if (in_array('kedTag', $object['objectclass'])) {
            return $this->canTag($userDn, $access, $object);
        }
        if (in_array('kedAcl', $object['objectclass'])) {
            return $this->canAcl($userDn, $access, $object);
        }
        if ($userDn === '') {
            return $this->canAnonymousUser($access, $object);
        }

        return true;
    }

    protected function canAnonymousUser($access, $object) {
        $tags = [];
        if (!isset($object['kedrelatedtag'])) { return true; }
        $tags = $this->ked->getRelatedTags($object['dn']);
        if (!empty($tags)) { }
        return true;
    }

    protected function canTag (string $userDn, string $access, array $object):bool {
        if ($userDn === '') { return false; }
        return true;
    }
    protected function canAcl (string $userDn, string $access, array $object):bool {
        if ($userDn === '') { return false; }
        return true;
    }
}