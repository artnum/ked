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
    function can ($user, string $access, string $objectDn):bool {
        /*$object = $this->ked->getRawLdapObjectByDn($objectDn);
        if (in_array('kedTag', $object['objectclass'])) {
            return $this->canTag($user, $access, $object);
        }
        if (in_array('kedAcl', $object['objectclass'])) {
            return $this->canAcl($user, $access, $object);
        }
        if ($user === null) {
            return $this->canAnonymousUser($access, $object);
        }*/

        return true;
    }

    protected function canAnonymousUser($access, $object) {
        $tags = [];
        if (!isset($object['kedrelatedtag'])) { return true; }
        $tags = $this->ked->getRelatedTags($object['dn']);
        if (!empty($tags)) { }
        return true;
    }

    protected function canTag ($user, string $access, array $object):bool {
        if ($user === null) { return false; }
        return true;
    }
    protected function canAcl ($user, string $access, array $object):bool {
        if ($user === null) { return false; }
        return true;
    }
}