<?PHP
declare(strict_types=1);
namespace ked;

require_once('ked-user.php');

use Iterator;
use Normalizer;

/* when returning object, attributes are named with the following convention :
  attributeName -> an attribute from data
  +attributeName -> an attribute to indicated some state not linked to actual stored data
  __attributeName -> an attribute might be used by the process but must be stripped before sent to client
*/
  
class ked {
    protected $conn;
    protected $rwconn;
    protected $base;

    /* public name => [ ldap name, sanitize string [input only], bin object, dn to other entry ] */
    const attrMap = [
        'type' => ['kedContentType', true, false, false],
        'name' => ['kedName', true, false, false],
        'id' => ['kedId', false, false, false],
        'description' => ['kedDescription', true, false, false],
        'created'  => ['kedTimestamp', false, false, false],
        'modified' => ['kedModified', false, false, false],
        'deleted' => ['kedDeleted', false, false, false],
        'archived' => ['kedArchived', false, false, false],
        'signature' => ['kedSignature', false, false, false],
        'application' => ['kedApplication', true, false, false],
        'content' => ['kedContent', false, false, false],
        /* content ref are, at least, transformed into some URL where client
         * can get the full content of the entry. If this is set, it means
         * the content is preview. Usefull for storing image in smaller size
         * into content and a accessible full size image.
         * Content should be limited to somthing like 2-4k.
         */
        'contentRef' => ['kedContentReference', false, false, false],
        'taskEnd' => ['kedTaskEnd', false, false, false],
        'taskDone' => ['kedTaskDone', false, false, false],
        'taskPrevious' => ['kedTaskPrevious', false, false, true],
        'tags' => ['kedRelatedTag', false, false, true],
        'user' => ['kedUser', false, false, false]
    ];

    const classAttrMap = [
        'kedTask' => [ 'kedTaskEnd', 'kedTaskDone', 'kedTaskPrevious' ],
        'kedEvent' => [ 'kedEventStart' , 'kedEventStop', 'kedEventAttendee', 'kedEventOrganizer' ]
    ];

    function __construct ($ldapconn, $base)
    {
        $this->conn = $ldapconn;
        $this->rwconn = $ldapconn;
        $this->dirBase = $base;
        $this->base = null;
        $this->tagBase = null;
        $this->aclBase = null;
        $this->currentUser = null;
        $this->acl = null;
    }

    function init():bool {
        $filter = $this->buildFilter('(objectClass=kedRoot)');
        $res = @ldap_search(
            $this->conn,
            $this->dirBase,
            $filter,
            [ 'kedRootType' ]
        );
        if (!$res) { $this->ldapFail($this->conn); return false; }
        for ($entry = @ldap_first_entry($this->conn, $res); $entry; $entry = ldap_next_entry($this->conn, $entry)) {
            $kedRootType = @ldap_get_values($this->conn, $entry, 'kedRootType');
            if (!$kedRootType) { continue; }
            if ($kedRootType['count'] <= 0) { continue; }
            $dn = @ldap_get_dn($this->conn, $entry);
            switch($kedRootType[0]) {
                case 'content': $this->base = $dn; break;
                case 'tag': $this->tagBase = $dn; break;
                case 'acl': $this->aclBase = $dn; break;

            }
        }
        if ($this->base === null) { return false; }
        if ($this->tagBase === null) { $this->tagBase = $this->base; }
        if ($this->aclBase === null) { $this->aclBase = $this->base; }

        $rootTag = $this->findTag('__root__');
        if (!$rootTag) {
            if (!$this->createTag('__root__')) { return false; }
            $rootTag = $this->findTag('__root__');
            if (!$rootTag) { return false; }
        }

        $this->rootTag = $rootTag;
        return true;
    }

    function setAcl (ACL $acl) {
        $this->acl = $acl;
    }

    function setCurrentUser (User $user) {
        $this->currentUser = $user;
    }

    function setUserStore ($store) {
        $this->userStore = $store;
    }

    /* for master/slave structure, add a write connection */
    function setRWLdapConn ($rwconn):void {
        $this->rwconn = $rwconn;
    }

    function getLdapConn (bool $rw = false) {
        if ($rw) { return $this->rwconn; }
        return $this->conn;
    }

    function getBase() {
        return $this->dirBase;
    }

    function getDocumentBase() {
        return $this->base;
    }

    function setTagsBase (string $tagsBase):void {
        $this->tagsBase = $tagsBase;
    }

    function setAclBase (string $aclBase):void {
        $this->aclBase = $aclBase;
    }

    function getAclBase() {
        return $this->aclBase;
    }

    /* normalized utf-8 */
    function sanitizeString (string $name):string {
        return Normalizer::normalize($name, Normalizer::FORM_C);
    }

    function buildFilter (string $format, string ...$args):string {
        /* escape for filter */
        foreach ($args as &$arg) {
            $arg = ldap_escape($arg, '', LDAP_ESCAPE_FILTER);
        }
        array_unshift($args, $format);
        return call_user_func_array('sprintf', $args);
    }

    function ldapFail($conn, string $message = ''):void {
        $frame = debug_backtrace(DEBUG_BACKTRACE_PROVIDE_OBJECT, 1)[0];
        error_log(sprintf('ked:[%s:%d#%s]: LDAP:<%s> "%s"', basename($frame['file']), $frame['line'], $frame['function'], ldap_error($conn), $message));
    }
    
    function logicFail(string $message):void {
        $frame = debug_backtrace(DEBUG_BACKTRACE_PROVIDE_OBJECT, 1)[0];
        error_log(sprintf('ked:[%s:%d#%s]: LOGIC:<%s>', basename($frame['file']), $frame['line'], $frame['function'], $message));
    }

    function getLdapValue ($conn, $entry, string $mapName) {
        if (!isset(self::attrMap[$mapName])) { return null; }
        $lattr = self::attrMap[$mapName];
        $entryAttributes = @ldap_get_attributes($conn, $entry);
        if ($entryAttributes === false) { $this->ldapFail($conn); return null; }
        unset($entryAttributes['count']);
        if (!in_array($lattr[0], $entryAttributes)) { return null; }
        if ($lattr[2]) {
            $value = @ldap_get_values_len($conn, $entry, $lattr[0]);
            if (!$value) { $this->ldapFail($conn); return null; }
            if ($value['count'] === 1) { return $value[0]; }
            unset($value['count']);
            return $value;
        }
        $value = @ldap_get_values($conn, $entry, $lattr[0]);
        if (!$value) { $this->ldapFail($conn); return null; }
        if ($value['count'] === 1) { return $value[0]; }
        unset($value['count']);
        return $value;
    }

    function sanitizeOptions (&$entry, $options) {
        foreach (self::attrMap as $attr => $lattr) {
            if (!empty($options[$attr])) {
                if (is_array($options[$attr])) {
                    $entry[$lattr[0]] = [];
                    foreach ($options[$attr] as $value) {
                        if (is_scalar($value) && !in_array($value, $entry[$lattr[0]], true)) {
                            $entry[$lattr[0]][] = $lattr[1] ? $this->sanitizeString((string)$value) : (string)$value;
                        }
                    }
                } else {
                    $entry[$lattr[0]] = $lattr[1] ? $this->sanitizeString($options[$attr]) : $options[$attr];
                }
            }
        }
    }

    function createDocument (string $name, array $options = []):?string {
        $rdn = $this->createRdn($options);
        /* fill with options first, then overwrite what shouldn't be touched */
        $document = [];
        /* we create a sub-document, so find the parent and add it as child */
        
        $parent = $this->base;
        if (!empty($options['parent'])) {
            $parent = $options['parent'];
        }

        $this->sanitizeOptions($document, $options);
        $document['kedId'] = $rdn[1];
        $document['kedTimestamp'] = $rdn[2];
        $document['kedModified'] = $rdn[2];
        $document['kedName'] =$this->sanitizeString($name);
        $document['objectClass'] = 'kedDocument';
        if (!empty($options['tags'])) {
            $document['kedRelatedTag'] = [];
            foreach ($options['tags'] as $tag) {
                $document['kedRelatedTag'][] = $tag;
            }
        }
        if ($this->currentUser) {
            $document['kedUser'] = $this->currentUser->getDn();
        }

        /* base is from configuration, rdn is generated, no need to escape */
        $dn = sprintf('%s,%s', $rdn[0], $parent);
        $res = @ldap_add($this->rwconn, $dn, $document);
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        return $dn;
    }

    function createEntry (string $docDn, ?string $content, array $options = []):?string {
        $rdn = $this->createRdn($options);

        /* fill with options first, then overwrite what shouldn't be touched */
        $entry = [];
        $this->sanitizeOptions($entry, $options);
        $entry['kedId'] = $rdn[1];
        $entry['kedTimestamp'] = $rdn[2];
        $entry['kedModified'] = $rdn[2];
        if (!empty($content) && $content !== null) {
            $entry['kedContent'] = $content;
        }
        if ($this->currentUser) {
            $entry['kedUser'] = $this->currentUser->getDn();
        }
        $entry['objectClass'] = 'kedEntry';
        
        /* some content must be somewhere */
        if (empty($entry['kedContent']) && empty($entry['kedContentReference'])) {
            return null;
        }

        /* base is from configuration, rdn is generated, no need to escape */
        $dn = sprintf('%s,%s', $rdn[0], $docDn);
        $res = @ldap_add($this->rwconn, $dn, $entry);
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        $this->updateInPlaceAny($docDn, ['modified' => time()]);
        if (isset($options['__update'])) { // when we call from updateEntry, we want to have previous entry full dn
            return $dn;
        }
        return $dn;
    }

    function createTag (string $tag, array $relatedTags = []):?array {
        $tag = $this->sanitizeString($tag);
        $exists = $this->findTag($tag);
        if ($exists) { return $exists; }

        $tagObject = [ 'kedIdName' => $tag, 'kedRelatedTag' => [], 'objectClass' => [ 'kedTag' ] ];
        foreach ($relatedTags as $relatedTag) {
            $relatedTag = $this->sanitizeString($relatedTag);
            $relatedTagObject = $this->findTag($relatedTag);
            if (!$relatedTag) { continue; } // don't fail if related tag don't exist
            $tagObject['kedRelatedTag'][] = $relatedTagObject['dn'];
        }

        /* allow creation of root tag from this function. All other tags must have __root__ related */
        if ($tag !== '__root__') {
            if (!in_array($this->rootTag['dn'], $tagObject['kedRelatedTag'])) {
                $tagObject['kedRelatedTag'][] = $this->rootTag['dn'];
            }
        }
        if (empty($tagObject['kedRelatedTag'])) { unset($tagObject['kedRelatedTag']); }

        $dn = 'kedIdName=' . ldap_escape($tag, '', LDAP_ESCAPE_DN) . ',' . $this->tagBase;
        $res = @ldap_add($this->rwconn, $dn, $tagObject);
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
    
        return $this->getRawLdapObjectByDn($dn);
    }

    function getRelatedTags (string $dn, $recurseParent = true):array {
        $related = [];
        do {
            $object = $this->getRawLdapObjectByDn($dn);
            if (isset($object['kedrelatedtag'])) {
                foreach ($object['kedrelatedtag'] as $rTag) {
                    $tag = $this->getRawLdapObjectByDn($rTag);
                    if (!$tag) { continue; }
                    if (isset($related[$tag['dn']])) { continue; }
                    $related[$tag['dn']] = $tag;
                    $r = $this->getRelatedTags($rTag, false);
                    if (!$r) { continue; }
                    foreach ($r as $k => $v) {
                        if (!isset($related[$k])) {
                            $related[$k] = $v;
                        }
                    }
                }
            }
            $dn = $this->getParentDn($dn);
        } while ($recurseParent && !$this->hasNotReachParent($dn, $this->base));
        return $related;
    }

    function hasNotReachParent ($dn1, $dn2) {
        if (empty($dn1)) { return true; }
        if (empty($dn2)) { return true; }
        $d1 = ldap_explode_dn($dn1, 0);
        $d2 = ldap_explode_dn($dn2, 0);
        if ($d1['count'] !== $d2['count']) { return false; }
        for($i = 0; $i < $d1['count']; $i++) {
            if ($d1[$i] !== $d2[$i]) { return false; }
        }
        return true;
    }

    function findActiveTags (
        array $options = ['deleted' => false, 'archived' => false],
        array $limits = [100, 1]
    ) {

        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $filter = $this->buildFilter('(&(objectclass=kedDocument)(kedRelatedTag=*)(!(kedNext=*))' . $filterOption . ')');
        $tags = [];
    
        foreach ($this->ldap_search($this->base, $filter, [ 'kedrelatedtag' ], $limits) as $entry) {
            if ($this->acl) {
                if(!$this->acl->can($this->currentUser, 'access', $entry['dn'])) { continue; }
            }
            foreach ($entry['kedrelatedtag'] as $tagDn) {
                if ($this->rootTag['dn'] === $tagDn) { continue; }
                $name = $this->getTagName($tagDn);
                if (!isset($tags[$name])) {
                    $tags[$name] = [
                        'count' => 0
                    ];
                }
                $tags[$name]['count']++;
            }
        }
        return $tags;
    }

    function findTag (
        string $tag,
        array $options = ['deleted' => false, 'archived' => false],
        array $limits = [-1, -1]
    ):?array {

        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $filter = $this->buildFilter('(&(objectclass=kedTag)(kedIdName=%s)' . $filterOption . ')', $this->sanitizeString($tag));
        $currentEntry = $this->ldap_search($this->tagBase, $filter, [ '*' ], $limits)->current();
        if (!$currentEntry) { return null; }
        return $currentEntry;
    }

    function getTagName (string $tagDn):?string {
        $entry = $this->getRawLdapObjectByDn($tagDn);
        if (!$entry) { return null; }
        return $entry['kedidname'][0];
    }

    function findSubTags (
        string $tagDn,
        array $options = ['deleted' => false, 'archived' => false],
        array $limits = [ -1, -1 ]
    ):array {

        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $filter = $this->buildFilter('(&(objectclass=kedTag)(kedRelatedTag=%s)' . $filterOption . ')', $tagDn);
        $objects = [];
        foreach($this->ldap_search($this->tagBase, $filter, ['*'], $limits) as $object) {
            if (isset($objects[$object['dn']])) { continue; }
            $objects[$object['dn']] = $object;
            $subtags = $this->findSubTags($object['dn'], [], $limits);
            if (!empty($subtags)) {
                foreach ($subtags as $k => $v) {
                    if (!isset($objects[$k])) {
                        $objects[$k] = $v;
                    }
                }
            }
        }
        return $objects;
    }

    function findByTags (array $tags, $limits = [ -1, -1 ]):array {
        if (empty($tags)) { return []; }
        $tagsDn = [];
        foreach ($tags as $tag) {
            $tagObject = $this->findTag($tag);
            if (!$tagObject) { continue; }
            if (!in_array($tagObject['dn'], $tagsDn)) {
                $tagsDn[] = $tagObject['dn'];
            }
            $relatedTags = $this->findSubTags($tagObject['dn']);
            foreach (array_keys($relatedTags) as $relatedTag) {
                if (!in_array($relatedTag, $tagsDn)) {
                    $tagsDn[] = $relatedTag;
                }
            }
        }

        $objects = [];
        foreach ($tagsDn as $tagDn) {
            /* exclude __root__ as everyone have it (or is supposed to have it) */
            if ($tagDn === $this->rootTag['dn']) { continue; }
            /* search entry, documents and tags. We want everything */
            $filter = $this->buildFilter('(kedRelatedTag=%s)', $tagDn);
            foreach ([$this->base, $this->tagBase] as $base) {
                $res = @ldap_search($this->conn, $base, $filter, ['objectclass'], 0, $limits[0], $limits[1]);
                if (!$res) { continue; }
                for ($entry = @ldap_first_entry($this->conn, $res); $entry; $entry = @ldap_next_entry($this->conn, $entry)) {
                    $dn = @ldap_get_dn($this->conn, $entry);
                    if (!$dn) { continue; }
                    if (isset($objects[$dn])) { continue; }
                    $oc = ldap_get_values($this->conn, $entry, 'objectclass');
                    if (!$oc) { continue; }
                    unset($oc['count']);
                    $objects[$dn] = [
                        'dn' => $dn,
                        'objectclass' => $oc
                    ];
                }
            }
        }
        return $objects;
    }

    function listTags(array $limits = [-1, -1]):array {
        $tags = [];
        $filter = $this->buildFilter('(objectclass=kedTag)');
        foreach (
            $this->ldap_search(
                $this->tagBase,
                $filter,
                [ 'kedIdName'],
                $limits,
                LDAP_DEREF_NEVER,
                [
                    [   
                        'oid' => LDAP_CONTROL_SORTREQUEST,
                        'iscritical' => false,
                        'value' => [ ['attr' => 'kedIdName'] ]
                    ]
                ]
        ) as $entry) {
            if (empty($entry['kedidname'])) { continue; }
            $tags[] = $entry['kedidname'][0];
        }
        return $tags;
    }

    function searchTags(string $expression, array $limits = [-1, -1]):array {
        $tags = [];
        $filter = $this->buildFilter('(&(objectclass=kedTag)(kedIdName=*%s*))', $expression);
        foreach ($this->ldap_search(
            $this->tagBase,
            $filter,
            [ 'kedIdName' ],
            $limits,
            [
                [
                    'oid' => LDAP_CONTROL_SORTREQUEST, 
                    'iscritical' => false, 
                    'value' => [ ['attr' => 'kedIdName'] ]
                ]
            ]
        ) as $entry) {
            if ($this->rootTag['dn'] === $entry['dn']) { continue; }
            if (empty($entry['kedidname'])) { continue; }
            $tags[] = $entry['kedidname'][0];
        }
        return $tags;
    }

    function addTag (string $dn, string $tagDn) {
        $object = $this->getRawLdapObjectByDn($dn);
        $relatedTag = [];
        if (!empty($object['kedrelatedtag'])) {
            $relatedTag = $object['kedrelatedtag'];
        }
        $relatedTag[] = $tagDn;
        $res = @ldap_mod_replace(
            $this->rwconn,
            $dn,
            ['kedRelatedTag' => $relatedTag]
        );
        if (!$res) { $this->ldapFail($res); return null; }
        $this->updateInPlaceAny($dn, ['modified' => time()]);
        return $object['kedid'][0];
    }

    function removeTags (string $dn, array $tagsDn) {
        $object = $this->getRawLdapObjectByDn($dn);
        if (!$object) { return null; }
        if (empty($object['kedrelatedtag'])) { return $object['kedid'][0]; }
        foreach ($tagsDn as $tagDn) {
            $key = array_search($tagDn, $object['kedrelatedtag']);
            if (!$key) { return $object['kedid']; }
            array_splice($object['kedrelatedtag'], $key, 1);
        }
        if (empty($object['kedrelatedtag'])) {
            $res = @ldap_mod_del(
                $this->rwconn,
                $dn,
                ['kedrealtedtag' => []]
            );
            if (!$res) { $this->ldapFail($this->rwconn); return false; }
            return $object['kedid'][0];
        }
        $res = @ldap_mod_replace(
            $this->rwconn,
            $dn,
            ['kedRelatedTag' => $object['kedrelatedtag']]
        );
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        $this->updateInPlaceAny($dn, ['modified' => time()]);
        return $object['kedid'][0];
    }

    function removeTag (string $dn, string $tagDn) {
        $object = $this->getRawLdapObjectByDn($dn);
        if (!$object) { return null; }
        if (empty($object['kedrelatedtag'])) { return $object['kedid'][0]; }
        $key = array_search($tagDn, $object['kedrelatedtag']);
        if (!$key) { return $object['kedid']; }
        array_splice($object['kedrelatedtag'], $key, 1);
        if (empty($object['kedrelatedtag'])) {
            $res = @ldap_mod_del(
                $this->rwconn,
                $dn,
                ['kedrealtedtag' => []]
            );
            if (!$res) { $this->ldapFail($this->rwconn); return false; }
            return $object['kedid'][0];
        }
        $res = @ldap_mod_replace(
            $this->rwconn,
            $dn,
            ['kedRelatedTag' => $object['kedrelatedtag']]
        );
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        return $object['kedid'][0];
    }

    /* Find documents metadata for matching name */
    function findDocuments (
        string $name,
        array $options = ['deleted' => false, 'archived' =>false], 
        array $limits = [-1, -1]
    ):array {
        if (empty($name)) { return []; }
        $options = array_merge(['deleted' => false, 'archived' =>false], $options);

        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $documents = [];
        $filter = $this->buildFilter('(&(objectclass=kedDocument)(kedName=*%s*)' . $filterOption . ')', $name);
        foreach($this->ldap_search(
            $this->base,
            $filter,
            [ '*' ],
            $limits,
            [],
            [$this, 'getLdapObject']
        ) as $currentEntry) {
            if ($currentEntry === null) { $document[] = ['+failed' => true]; continue; }
            $documents[] = $currentEntry;
        }
        return $documents;
    }

    function getRawLdapObjectByDn (string $dn):?array {
        $res = @ldap_read($this->conn, $dn, '(objectclass=*)', [ '*' ]);
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return null; }
        return $this->getRawLdapObject($this->conn, $entry);
    }

    function getRawLdapObject ($conn, $entry):?array {
        $currentEntry = [ 'dn' => ldap_get_dn($conn, $entry) ];
        if (!$currentEntry['dn']) { $this->ldapFail($this->conn); return null; }
        for ($attr = @ldap_first_attribute($this->conn, $entry); $attr; $attr = @ldap_next_attribute($this->conn, $entry)) {
            $values =  @ldap_get_values($this->conn, $entry, $attr);
            if (!$values) { $this->ldapFail($this->conn); return null; }
            unset($values['count']);
            if (empty($values)) { continue; }
            $currentEntry[strtolower($attr)] = $values;
        }
        return $currentEntry;
    }

    function getLdapObject ($conn, $entry):array {
        $currentEntry =[ 'dn' => ldap_get_dn($conn, $entry) ];
        if (!$currentEntry['dn']) { $this->ldapFail($conn); return []; }
        foreach (self::attrMap as $attr => $_) {
            $value = $this->getLdapValue($conn, $entry, $attr);
            if ($value !== null) { $currentEntry[$attr] = $value; }
        }
        if (isset($currentEntry['tags'])) {
            if (!is_array($currentEntry['tags'])) {
                $currentEntry['tags'] = [ $currentEntry['tags'] ];
            }
            $tags = [];
            foreach ($currentEntry['tags'] as $tagDn) {
                if ($tagDn === $this->rootTag['dn']) { continue; }
                $tags[] = $this->getTagName($tagDn);
            }
            $currentEntry['tags'] = $tags;
        } else {
            $currentEntry['tags'] = [];
        }
        $objectclasses = ldap_get_values($conn, $entry, 'objectClass');
        unset($objectclasses['count']);
        $currentEntry['+class'] = [];
        foreach($objectclasses as $type) {
            switch ($type) {
                case 'kedEntry': $currentEntry['+class'][] = 'entry'; break;
                case 'kedDocument': $currentEntry['+class'][] = 'document'; break;
                case 'kedTask': $currentEntry['+class'][] = 'task'; break;
                case 'kedEvent': $currentEntry['+class'][] = 'event'; break;
            }
        }

        $users = [];
        if ($this->userStore && !empty($currentEntry['user'])) {
            if (!is_array($currentEntry['user'])) { $currentEntry['user'] = [$currentEntry['user']]; }
            foreach ($currentEntry['user'] as $userid) {
                $user = FullUser::fromDN($this, $userid);
                if ($user) {
                    $users[$user->getUid()] = $user->getDisplayName();
                }
            }
        }
        $currentEntry['user'] = $users;

        return $currentEntry;
    }

    function getUserByUid (string $uid) {
        return $this->userStore->getUser($uid);
    }

    function getUserByDbId (string $dbId) {
        return $this->userStore->getUserByDbId($dbId);
    }

    function getObjectUsersObjects (string $dn):array {
        $users = [];
        $res = @ldap_read(
            $this->conn,
            $dn,
            '(objectclass=*)',
            [
                'kedUser'
            ]
        );
        if (!$res) { $this->ldapFail($this->conn); return $users; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return $users; }
        $values =  @ldap_get_values($this->conn, $entry, 'kedUser');
        if (!$values) { return $users; }
        if ($values['count'] <= 0) { return $users; }
        for ($i = 0; $i < $values['count']; $i++) {
            $user = FullUser::fromDN($this, $values[$i]);
            if ($user) { $users[] = $user; }
        }
        return $users;
    }

    function getMetadata (string $dn):?array {
        $res = @ldap_read($this->conn, $dn, '(objectclass=*)', [ 
            'kedId',
            'kedName',
            'kedTimestamp',
            'kedDeleted',
            'kedModified',
            'objectClass',
            'kedContentType',
            'kedSignature',
            'kedApplication',
            'kedContentReference',
            'kedRelatedTag',
            'kedArchived'
        ]);
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return null; }
        return $this->getLdapObject($this->conn, $entry);
    }

    function getAll (string $dn):?array {
        $res = @ldap_read($this->conn, $dn, '(objectclass=*)', [ '*' ]);
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return null; }
        return $this->getLdapObject($this->conn, $entry);
    }

    function getObjectClasses (string $dn):array {
        $res = @ldap_read($this->conn, $dn, '(objectclass=*)', [ 'objectClass' ]);
        if (!$res) { $this->ldapFail($this->conn); return []; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return []; }
        $classes = @ldap_get_values($this->conn, $entry, 'objectClass');
        if (!$classes) { $this->ldapFail($this->conn); return []; }
        unset($classes['count']);
        return $classes;
    }

    /* Return document content */
    function getDocument (string $docDn, array $limits = [ -1, -1]):array {
        /* get document */
        $res = @ldap_read(
            $this->conn,
            $docDn,
            '(objectClass=kedDocument)',
            [ '*' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return []; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail($this->conn); return []; }
        if ($entriesCount !== 1) { $this->logicFail( 'Should have only one entry'); return []; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return []; }
        $document = $this->getLdapObject($this->conn, $entry);
        if (!$document) { return []; }

        return $document;
    }

    function listDocumentEntries (
        string $docDn,
        array $options = ['archived' => false, 'deleted' => false],
        array $limits = [-1, -1]
    ):array {
        $entries = [];
        
        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $res = @ldap_list(
            $this->conn,
            $docDn,
            '(&(objectclass=kedEntry)(!(kedNext=*))' . $filterOption . ')', 
            [ 
                'kedId',
                'kedTimestamp',
                'kedDeleted',
                'kedModified',
                'objectClass',
                'kedContentType',
                'kedSignature',
                'kedApplication',
                'kedArchived',
                'kedUser',
                'kedDescription'
            ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return $entries; }
        for ($e = @ldap_first_entry($this->conn, $res); $e; $e = @ldap_next_entry($this->conn, $e)) {
            $entries[] = $this->getLdapObject($this->conn, $e);
        }
        return $entries;
    }

    function countDocumentEntries (
        string $docDn,
        array $options = ['archived' => false, 'deleted' => false],
        array $limits = [-1, -1]
    ):int {

        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $res = @ldap_list(
            $this->conn,
            $docDn,
            '(&(objectclass=kedEntry)(!(kedNext=*))' . $filterOption . ')',
            [ 'dn' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return -1; }
        $countEntries = @ldap_count_entries($this->conn, $res);
        if ($countEntries === false) { $this->ldapFail($this->conn); return -1; }
        return $countEntries;
    }

    function countDocumentChilds (
        string $docDn,
        array $options = ['archived' => false, 'deleted' => false],
        array $limits = [-1, -1]
    ):int {

        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        /* count child documents */
        $res = @ldap_list(
            $this->conn,
            $docDn,
            $filterOption !== '' ? '(&(objectclass=kedDocument)(!(kedNext=*))' . $filterOption . ')' : '(objectClass=kedDocument)',
            [ 'dn' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return -1; } 
        $countChilds = @ldap_count_entries($this->conn, $res);
        if ($countChilds === false) { $this->ldapFail( $this->conn); return -1; }
        return $countChilds;
    }

    /* Return the entry currently active for given entry and document id */
    function getCurrentEntry (
        string $docDn,
        string $entryId,
        $options = ['archived' => false, 'deleted' => false],
        array $limits = [-1, -1]
    ):?array {

        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $filter = $this->buildFilter('(&(objectclass=kedEntry)(kedId=%s)(!(kedNext=*))' . $filterOption . ')', $entryId);
        $res = @ldap_list(
            $this->conn,
            $docDn,
            $filter,
            [ '*' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail($this->conn); return null; }
        if ($entriesCount > 1) { $this->logicFail( 'Too many entries'); return null; }
        if ($entriesCount < 1) { return null; }
        $currentEntry = [];
        $entry = @ldap_first_entry($this->conn , $res);
        $currentEntry = $this->getLdapObject($this->conn, $entry);
        if (!$currentEntry) { return null; }

        return $currentEntry;
    }

    function getParentDn (string $dn):string {
        $parts = ldap_explode_dn($dn, 0);
        unset($parts['count']);
        array_shift($parts);
        return implode(',', $parts);
    }

    function getCurrentEntryByDn(
        string $entryDn,
        array $limits = [-1, -1],
        array $options = ['archived' => false, 'deleted' => false]
    ):?array {

        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $entry = $this->getMetadata($entryDn);
        $filter = $this->buildFilter('(&(objectClass=kedEntry)(kedId=%s)(!(kedNext=*))' . $filterOption . ')', $entry['id']);

        $res = @ldap_list(
            $this->conn,
            $this->getParentDn($entry['dn']),
            $filter,
            [ '*' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail($this->conn); return null; }
        if ($entriesCount > 1) { $this->logicFail( 'Too many entries'); return null; }
        if ($entriesCount < 1) { return null; }
        
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return null; }
        return $this->getLdapObject($this->conn, $entry);
    }

    /* Return historic entries for given entry and document id */
    function getEntryHistory (
        string $docDn,
        string $entryId,
        array $options = ['archived' => false, 'deleted' => false],
        array $limits = [-1, -1]
    ):array {
        
        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $history = [];
        $filter = $this->buildFilter('(&(objectclass=kedEntry)(kedId=%s)(kedNext=*)' . $filterOption . ')', $entryId);
        $res = @ldap_list(
            $this->conn,
            $docDn,
            $filter,
            [ '*' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return $history; }
        for ($entry = ldap_first_entry($this->conn, $res); $entry; $entry = ldap_next_entry($this->conn, $entry)) {
            $currentEntry = [ 'dn' => @ldap_get_dn($this->conn, $entry) ];
            /* a failed dn insert a failed entry */
            if (!$currentEntry['dn']) { $this->ldapFail($this->conn); $currentEntry['+failed'] = true; continue; }
            foreach(self::attrMap as $attr => $_) {
                $value = $this->getLdapValue($this->conn, $entry, $attr);
                if ($value !== null) { $currentEntry[$attr] = $value; }
            }
            $currentEntry['id'] = $currentEntry['id'] . '-' . $currentEntry['created'];
            $history[] = $currentEntry;
        }
        return $history;
    }

    function archive (string $dn) {
        $attrs = ['kedArchived' => time()];
        $res = @ldap_mod_add($this->rwconn, $dn, $attrs);
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        return $dn;
    }
    
    function unarchive (string $dn) {
        $attrs = ['kedArchived' => []];
        $res = @ldap_mod_del($this->rwconn, $dn, $attrs);
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        return $dn;
    }

    /* for auto-save features, update the content of the entry without creating history of the update */
    function updateInPlaceEntry (string $docId, string $entryId, string $content, array $options = []):string {
        $currentEntry = $this->getCurrentEntry($docId, $entryId);
        $updateCurrentEntry = ['kedContent' => $content, 'kedModified' => time()];
        if (!empty($options['type'])) {
            $updateCurrenEntry['kedType'] = $this->sanitizeString($options['type']);
        }
        if (!empty($options['signature'])) {
            $updateCurrentEntry['kedSignature'] = $this->sanitizeString($options['signature']);
        }
        if (!empty($options['contentRef'])) {
            $updateCurrentEntry['kedContentReference'] = $options['contentRef'];
        }
        if (!empty($currentEntry['kedUser'])) {
            if (!is_array($currentEntry['kedUser'])) { $currentEntry['kedUser'] = [$currentEntry['kedUser']]; }
            if (!in_array($this->currentUser->getDn(), $currentEntry['kedUser'])) {
                $updateCurrentEntry['kedUser'] = $currentEntry['kedUser'];
                $updateCurrentEntry['kedUser'][] = $this->currentUser->getDn();
            }
        }
        $res = ldap_mod_replace($this->rwconn, $currentEntry['dn'], $updateCurrenEntry);
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        $parentDn = $currentEntry;
        do {
            $parentDn = $this->updateParentModTime($parentDn, $updateCurrentEntry['kedModified']);
        } while($parentDn !== false);
        return $currentEntry['id'];
    }

    function updateEntry (string $docDn, string $entryId, ?string $content, array $options = []):?string {
        $currentEntry = $this->getCurrentEntry($docDn, $entryId);
        if ($currentEntry === null)  { return null; }
        $options['id'] = $currentEntry['id'];
        if (empty($options['type']) && !empty($currentEntry['type'])) {
            $options['type'] = $currentEntry['type']; // type is copied over
        }
        $options['__update'] = true;
        $newEntryDn = $this->createEntry($docDn, $content, $options);
        if ($newEntryDn === null) { return null; } 
        $updateCurrent = ['kedModified' => time(), 'kedNext' => $newEntryDn];
        if (!empty($currentEntry['kedUser'])) {
            if (!is_array($currentEntry['kedUser'])) { $currentEntry['kedUser'] = [$currentEntry['kedUser']]; }
            if (!in_array($this->currentUser->getDn(), $currentEntry['kedUser'])) {
                $updateCurrentEntry['kedUser'] = $currentEntry['kedUser'];
                $updateCurrentEntry['kedUser'][] = $this->currentUser->getDn();
            }
        }
        $res = ldap_mod_replace($this->rwconn, $currentEntry['dn'], $updateCurrent);
        if (!$res) { $this->ldapFail($this->rwconn); return null; }
        $parentDn = $newEntryDn;
        do {
            $parentDn = $this->updateParentModTime($parentDn, $updateCurrent['kedModified']);
        } while($parentDn !== false);
        return $currentEntry['id']; // update do not change the id
    }

    function updateEntryByDn (string $dn, ?string $content, array $options = []):?string {
        $currentEntry = $this->getCurrentEntryByDn($dn);
        if ($currentEntry === null) { return null; }
        $options['id'] = $currentEntry['id'];
        if (empty($options['type']) && !empty($currentEntry['type'])) {
            $options['type'] = $currentEntry['type'];
        }
        $options['__update'] = true;
        $newEntryDn = $this->createEntry($this->getParentDn($currentEntry['dn']), $content, $options);
        if ($newEntryDn === null) { return null; }
        $updateCurrent = [ 'kedModified' => time(), 'kedNext' => $newEntryDn ];
        if (!empty($currentEntry['kedUser'])) {
            if (!is_array($currentEntry['kedUser'])) { $currentEntry['kedUser'] = [$currentEntry['kedUser']]; }
            if (!in_array($this->currentUser->getDn(), $currentEntry['kedUser'])) {
                $updateCurrentEntry['kedUser'] = $currentEntry['kedUser'];
                $updateCurrentEntry['kedUser'][] = $this->currentUser->getDn();
            }
        }
        $res = @ldap_mod_replace($this->rwconn, $currentEntry['dn'], $updateCurrent);
        if (!$res) {
            /* rollback operation */
            $this->ldapFail($this->rwconn);
            if (!@ldap_delete($this->rwconn, $newEntryDn)) {
                $this->ldapFail($this->rwconn, 'Directory must be in bad state for this to happen');
            }
            return null;
        }
        $parentDn = $newEntryDn;
        do {
            $parentDn = $this->updateParentModTime($parentDn, $updateCurrent['kedModified']);
        } while($parentDn !== false);
        return $newEntryDn;
    }

    function updateInPlaceAny (string $dn, array $params = []):bool {
        $attributes = [];
        $delAttributes = [];
        foreach (self::attrMap as $attr => $lattr) {
            if (isset($params['-' . $attr])) {
                $delAttributes[$lattr[0]] = [];
                continue;
            }
            if (!isset($params[$attr])) { continue; }
            $attributes[$lattr[0]] = $lattr[1] ? $this->sanitizeString($params[$attr]) : $params[$attr];
        }
        if (empty($delAttributes) && empty($attributes)) { return true; }
        
        $attributes['kedModified'] = time();
        if (!empty($delAttributes)) {
            $res = @ldap_mod_del($this->rwconn, $dn, $delAttributes);
            if (!$res) { $this->ldapFail($this->rwconn, $dn); return false; }
        }
        /* we must do replace as, at least, we have modified timestamp to update */
        $res = @ldap_mod_replace($this->rwconn, $dn, $attributes);
        if (!$res) { $this->ldapFail($this->rwconn); return false; }
        $parentDn = $dn;
        do {
            $parentDn = $this->updateParentModTime($parentDn, $attributes['kedModified']);
        } while($parentDn !== false);
        return true;
    }

    function updateParentModTime (string $dn, int $time) {
        $parentDn = $this->getParentDn($dn);
        if ($parentDn === $this->base) { return false; }
        $attribute = [ 'kedModified' => $time ];
        $res = @ldap_mod_replace($this->rwconn, $parentDn, $attribute);
        if (!$res) { $this->ldapFail($this->rwconn); return false; }
        return $parentDn;
    }

    function addClasses (string $dn, array $classes):bool {
        $currentClasses = $this->getObjectClasses($dn);
        if (empty($currentClasses)) { return false; }
        foreach ($classes as $c) {
            if (!in_array($c, $currentClasses)) {
                $currentClasses[] = $c;
            }
        }
        $res = @ldap_mod_replace($this->rwconn, $dn, [ 'objectClass' => $currentClasses, 'kedModified' => time() ]);
        if (!$res) { $this->ldapFail($this->rwconn); }
        return $res;
    }

    function removeClasses (string $dn, array $classes):void {
        $currentClasses = $this->getObjectClasses($dn);
        if (empty($currentClasses)) { return; }
        $attributes = [];
        if (empty($classes)) { return; }
        foreach ($classes as $c) {
            if (($k = array_search($c, $currentClasses))) {
                foreach (self::classAttrMap[$c] as $attr) {
                    $attributes[$attr] = [];
                }
            }
            unset($currentClasses[$k]);
        }
        
        $res = @ldap_mod_replace($this->rwconn, $dn, $attributes);
        if (!$res) { $this->ldapFail($this->rwconn); }
        if ($res) {
            $res = @ldap_mod_replace($this->rwconn, $dn, [ 'objectClass' => $currentClasses, 'kedModified' => time() ]);
            if (!$res) { $this->ldapFail($this->rwconn, var_export($currentClasses, true)); }
        }
    }

    function createRdn (array $options = []):array {
        $id = null;
        if (!empty($options['id']) && is_string($options['id'])) {
            $id = $options['id']; // application offer an id, use it
        }
        if ($id === null) {
            $id = uniqid('', true); // should be enough
            /* look better in base36 */
            $id = base_convert(explode('.', $id)[0], 16, 36) . base_convert(explode('.', $id)[1], 10, 36);
        }
        $ts = time();
        return [sprintf('kedId=%s+kedTimestamp=%d', $id, $ts), $id, $ts];
    }

    function getDnByName (string $name, string $parentDn):?string {
        $filter = $this->buildFilter('(&(|(kedName=%s)(kedApplication=%s))(!(kedNext=*)))', $name, 'ked:name=' . $name);
        $res = @ldap_list($this->conn, $parentDn, $filter, [ 'dn' ]);
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $countEntries = @ldap_count_entries($this->conn, $res);
        if ($countEntries === false) { $this->ldapFail($this->conn); return null; }
        if ($countEntries !== 1) { return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return null;}
        $dn = @ldap_get_dn($this->conn, $entry);
        if (!$dn) { $this->ldapFail($this->conn); return null; }
        return $dn;
    }

    function getActiveDn (
        string $id,
        array $options = ['parent' => '', 'timestamp' => null, 'archived' => false, 'deleted' => false, 'document' => false],
        array $limits = [-1, -1]
    ):?string {

        $options = array_merge(['parent' => $this->base, 'timestamp' => null, 'archived' => false, 'deleted' => false, 'document' => false], $options);
    
        $filterOption = '';
        if ($options['timestamp']) { $filterOption = $this->buildFilter('(kedTimestamp=%s)', $options['timestamp']); }
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }
        if ($options['document']) { $filterOption .= '(objectClass=kedDocument)'; }

        $filter =  $this->buildFilter('(&(kedId=%s)(!(kedNext=*))' . $filterOption . ')', $id);

        $res = @ldap_list(
            $this->conn,
            $options['parent'],
            $filter,
            [ 'dn' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail( $this->conn); return null; }
        if ($entriesCount > 1) { $this->logicFail('Too many entries'); return null; }
        if ($entriesCount < 1) { return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail($this->conn); return null; }
        $dn = @ldap_get_dn($this->conn, $entry);
        if (!$dn) { $this->ldapFail($this->conn); return null; }

        return $dn;
    }

    function deleteByDn (string $dn):bool {
        $meta = $this->getMetadata($dn);
        if (empty($meta['deleted'])) {
            $mod = ['kedDeleted' => time() ];
            $res = @ldap_mod_add($this->rwconn, $meta['dn'], $mod);
            if (!$res) { $this->ldapFail($this->rwconn); return false; }
            return true;
        }
    }
 
    /* Search while enforcing parent filter to child */
    function ldap_search (string $base, $filter, $attributes = ['*'], $limits = [-1, -1], $ctrls = [], $loadentry = null) {

        switch ($base) {
            case ':acl': $base = $this->aclBase; break;
            case ':tag': $base = $this->tagBase; break;
            case ':document': $base = $this->base; break;
        }

        $result = new KEDLdapResult();
        $result->search($this->conn, $base, $filter, $attributes, $limits, $ctrls, $loadentry);
        return $result;
    }
}

/* Iterator for ldap_search, non-recursive breadth-first */
class KEDLdapResult implements Iterator {
    public function __construct() {
        $this->results = [];
        $this->position = 0;
        $this->count = 0;

        $this->duration = 0;
        $this->bases = [];
        $this->limits = [ -1, -1 ];
        $this->ldap = null;
        $this->res = null;
        $this->filter = null;
        $this->ctrls = null;
        $this->attributes = [ '*' ];
        $this->loadentry = null;
    }

    public function search ($ldap, string $base, $filter, $attributes = ['*'], $limits = [-1, -1], $ctrls = [], $loadentry = null) {

        array_push($this->bases, $base);
        $this->ldap = $ldap;
        $this->limits = $limits;
        $this->ctrls = $ctrls;
        $this->attributes = $attributes;
        $this->filter = $filter;
        $this->res = null;
        $this->entry = null;
        $this->count = 0;
        $this->loadentry = $loadentry;

        $this->load_next_result();
    }

    public function load_entry($entry) {
        $currentEntry = [ 'dn' => @ldap_get_dn($this->ldap, $entry) ];
        if (!$currentEntry['dn']) { return null; }
        for ($attr = @ldap_first_attribute($this->ldap, $entry); $attr; $attr = @ldap_next_attribute($this->ldap, $entry)) {
            $values =  @ldap_get_values($this->ldap, $entry, $attr);
            if (!$values) {  return null; }
            unset($values['count']);
            if (empty($values)) { continue; }
            $currentEntry[strtolower($attr)] = $values;
        }
        return $currentEntry;
    }

    public function load_next_result () {
        if ( 
            ($this->limits[1] <= 0 || $this->duration < $this->limits[1]) &&
            ($this->limits[0] <= 0 || $this->count < $this->limits[0])
        ) {
            if ($this->res && $this->entry) {
                $entry = @ldap_next_entry($this->ldap, $this->entry);
                if (!$entry) { $this->entry = null; $this->res = null; }
                else {
                    $entryVal = $this->loadentry ? call_user_func($this->loadentry, $this->ldap, $entry) : $this->load_entry($entry);
                    if (!$entryVal) { $this->entry = null; $this->res = null; }
                    else { array_push($this->bases, $entryVal['dn']); array_push($this->results, $entryVal); $this->entry = $entry; $this->count++; }
                }
            }
            if ($this->res && !$this->entry) {
                $entry = @ldap_first_entry($this->ldap, $this->res);
                if (!$entry) { $this->entry = null; $this->res = null; }
                else {
                    $entryVal = $this->loadentry ? call_user_func($this->loadentry, $this->ldap, $entry) : $this->load_entry($entry);
                    if (!$entryVal) { $this->entry = null; $this->res = null; }
                    else { array_push($this->bases, $entryVal['dn']); array_push($this->results, $entryVal); $this->entry = $entry; $this->count++; }
                }
            }
            if (!$this->res && !$this->entry) {
                if (!empty($this->bases)) {
                    $start = time();
                    $res = @ldap_list($this->ldap, array_shift($this->bases), $this->filter, $this->attributes, 0, -1, $this->limits[1] - $this->duration, 0, $this->ctrls);
                    $this->duration += time() - $start;
                    if (!$res) { return $this->load_next_result(); }
                    $this->res = $res;
                    $this->entry = null;
                    return $this->load_next_result();
                }
            }
        }
    }

    public function next() {
        $this->load_next_result();
        return ++$this->position;
    }

    public function current() {
        return $this->results[$this->position];
    }

    public function rewind() {
        $this->position = 0;
    }

    public function key() {
        return $this->position;
    }
    public function valid() {
        return isset($this->results[$this->position]);
    }
}

?>