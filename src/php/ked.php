<?PHP
declare(strict_types=1);
namespace ked;

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
        'created'  => ['kedTimestamp', false, false, false],
        'modified' => ['kedModified', false, false, false],
        'deleted' => ['kedDeleted', false, false, false],
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
        'taskPrevious' => ['kedTaskPrevious', false, false, true]
    ];

    function __construct ($ldapconn, $base)
    {
        $this->conn = $ldapconn;
        $this->rwconn = $ldapconn;
        $this->base = $base;
    }

    /* for master/slave structure, add a write connection */
    function setRWLdapConn ($rwconn):void {
        $this->rwconn = $rwconn;
    }

    /* normalized utf-8 and an ascii version, useful for search */
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

    function ldapFail(string $function, $conn):void {
        error_log(sprintf('ked:%s: LDAP:<%s>', $function, ldap_error($conn)));
    }
    
    function logicFail(string $function, string $message):void {
        error_log(sprintf('ked:%s: LOGIC:<%s>', $function, $message));
    }

    function getLdapValue ($conn, $entry, string $mapName) {
        if (!isset(self::attrMap[$mapName])) { return null; }
        $lattr = self::attrMap[$mapName];
        if ($lattr[2]) {
            $value = @ldap_get_values_len($conn, $entry, $lattr[0]);
            if (!$value) { return null; }
            if ($value['count'] === 1) { return $value[0]; }
            unset($value['count']);
            return $value;
        }
        $value = @ldap_get_values($conn, $entry, $lattr[0]);
        if (!$value) { return null; }
        if ($value['count'] === 1) { return $value[0]; }
        unset($value['count']);
        return $value;
    }

    function convertToTask (string $dn):bool {
        $classes = $this->getObjectClasses($dn);
        if (empty($classes)) { return false; }
        if (in_array('kedTask', $classes)) { return true; }
        $classes[] = 'kedTask';
        $res = @ldap_mod_replace($this->rwconn, $dn, [ 'objectClass' => $classes ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->rwconn); return false; }
        return true;
    }

    function revertFromTask (string $dn):void {
        $classes = $this->getObjectClasses($dn);
        if (empty($classes)) { return; }
        if (!($k = array_search('kedTask', $classes))) { return; }
        unset($classes[$k]);
        @ldap_mod_del($this->rwconn, $dn, [ 'kedTaskEnd' => [], 'kedTaskDone' => [], 'kedTaskPrevious' => [] ]);
        @ldap_mod_replace($this->rwconn, $dn, [ 'objectClass' => $classes ]);
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

        /* base is from configuration, rdn is generated, no need to escape */
        $dn = sprintf('%s,%s', $rdn[0], $parent);
        $res = @ldap_add($this->rwconn, $dn, $document);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->rwconn); return null; }
        return $rdn[1];
    }

    function deleteEntry (string $docId, string $entryId) {
        $this->getCurrentEntry($docId, $entryId);
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
        $entry['objectClass'] = 'kedEntry';
        
        /* some content must be somewhere */
        if (empty($entry['kedContent']) && empty($entry['kedContentReference'])) {
            return null;
        }

        /* base is from configuration, rdn is generated, no need to escape */
        $dn = sprintf('%s,%s', $rdn[0], $docDn);
        $res = @ldap_add($this->rwconn, $dn, $entry);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->rwconn); return null; }
        if (isset($options['__update'])) { // when we call from updateEntry, we want to have previous entry full dn
            return $dn;
        }
        return $rdn[1];
    }

    /* Find documents metadata for matching name */
    function findDocuments (string $name):array {
        if (empty($name)) { return null; }
        $documents = [];
        $filter = $this->buildFilter('(&(objectclass=kedDocument)(kedName=*%s*))', $name);
        $res = @ldap_search($this->conn, $this->base, $filter, [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        for ($entry = @ldap_first_entry($this->conn, $res); $entry; $entry = @ldap_next_entry($this->conn, $entry)) {
            $currentEntry = $this->getLdapObject($this->conn, $entry);
            if ($currentEntry === null) { $document[] = ['+failed' => true]; continue; }
            $documents[] = $currentEntry;
        }
        return $documents;
    }

    function getLdapObject ($conn, $entry):array {
        $currentEntry =[ '__dn' => ldap_get_dn($conn, $entry) ];
        if (!$currentEntry['__dn']) { $this->ldapFail(__FUNCTION__, $conn); return null; }
        foreach (self::attrMap as $attr => $_) {
            $value = $this->getLdapValue($conn, $entry, $attr);
            if ($value !== null) { $currentEntry[$attr] = $value; }
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

        return $currentEntry;
    }

    function getMetadata (string $dn):?array {
        $res = @ldap_read($this->conn, $dn, '(objectclass=*)', [ 
            'kedId', 'kedTimestamp', 'kedDeleted', 'kedModified', 'objectClass', 'kedContentType', 'kedSignature', 'kedApplication'
            ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        return $this->getLdapObject($this->conn, $entry);
    }

    function getAll (string $dn):?array {
        $res = @ldap_read($this->conn, $dn, '(objectclass=*)', [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        return $this->getLdapObject($this->conn, $entry);
    }

    function getObjectClasses (string $dn):array {
        $res = @ldap_read($this->conn, $dn, '(objectclass=*)', [ 'objectClass' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return []; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail(__FUNCTION__, $this->conn); return []; }
        $classes = @ldap_get_values($this->conn, $entry, 'objectClass');
        if (!$classes) { $this->ldapFail(__FUNCTION__, $this->conn); return []; }
        unset($classes['count']);
        return $classes;
    }

    /* Return document content */
    function getDocument (string $docDn):array {
        /* get document */
        $res = @ldap_read($this->conn, $docDn, '(objectClass=kedDocument)', [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return []; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail(__FUNCTION__, $this->conn); return []; }
        if ($entriesCount !== 1) { $this->logicFail(__FUNCTION__, 'Should have only one entry'); return []; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail(__FUNCTION__, $this->conn); return []; }
        $document = $this->getLdapObject($this->conn, $entry);
        if (!$document) { return []; }
        
        $document['+childs'] = $this->countDocumentChilds($docDn);

        /* get entries */
        $res = @ldap_list($this->conn, $docDn, '(&(objectclass=kedEntry)(!(kedNext=*))(!(kedDeleted=*)))', [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return []; }
        $document['+entries'] = [];
        for ($entry = ldap_first_entry($this->conn, $res); $entry; $entry = ldap_next_entry($this->conn, $entry)) {
            $object = $this->getLdapObject($this->conn, $entry);
            if (!$object) { $document['+entries'][] = ['+failed' => true]; continue; }
            $document['+entries'][] = $object;
        }

        return $document;
    }

    function listDocumentEntries (string $docDn):array {
        $entries = [];
        $res = @ldap_list($this->conn, $docDn, '(&(objectclass=kedEntry)(!(kedNext=*))(!(kedDeleted=*)))', [ 
            'kedId', 'kedTimestamp', 'kedDeleted', 'kedModified', 'objectClass', 'kedContentType', 'kedSignature'
        ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return $entries; }
        for ($e = @ldap_first_entry($this->conn, $res); $e; $e = @ldap_next_entry($this->conn, $e)) {
            $entries[] = $this->getLdapObject($this->conn, $e);
        }
        return $entries;
    }

    function countDocumentEntries (string $docDn):int {
        $res = @ldap_list($this->conn, $docDn, '(&(objectclass=kedEntry)(!(kedNext=*))(!(kedDeleted=*)))', [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return -1; }
        $countEntries = @ldap_count_entries($this->conn, $res);
        if ($countEntries === false) { $this->ldapFail(__FUNCTION__, $this->conn); return -1; }
        return $countEntries;
    }

    function countDocumentChilds (string $docDn):int {
        /* count child documents */
        $res = @ldap_list($this->conn, $docDn, '(&(objectclass=kedDocument)(!(kedDeleted=*)))', [ 'dn' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return -1; } 
        $countChilds = @ldap_count_entries($this->conn, $res);
        if ($countChilds === false) { $this->ldapFail(__FUNCTION__, $this->conn); return -1; }
        return $countChilds;
    }

    /* Return the entry currently active for given entry and document id */
    function getCurrentEntry (string $docDn, string $entryId):?array {
        $filter = $this->buildFilter('(&(objectclass=kedEntry)(kedId=%s)(!(kedNext=*))(!(kedDeleted=*)))', $entryId);
        $res = @ldap_list($this->conn, $docDn, $filter, [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        if ($entriesCount > 1) { $this->logicFail(__FUNCTION__, 'Too many entries'); return null; }
        if ($entriesCount < 1) { return null; }
        $currentEntry = [];
        $entry = @ldap_first_entry($this->conn , $res);
        $currentEntry = $this->getLdapObject($this->conn, $entry);
        if (!$currentEntry) { return null; }

        return $currentEntry;
    }

    /* Return historic entries for given entry and document id */
    function getEntryHistory (string $docDn, string $entryId):array {
        $history = [];
        $filter = $this->buildFilter('(&(objectclass=kedEntry)(kedId=%s)(!(kedDeleted=*))(kedNext=*))', $entryId);
        $res = @ldap_list($this->conn, $docDn, $filter, [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return $history; }
        for ($entry = ldap_first_entry($this->conn, $res); $entry; $entry = ldap_next_entry($this->conn, $entry)) {
            $currentEntry = [ '__dn' => @ldap_get_dn($this->conn, $entry) ];
            /* a failed dn insert a failed entry */
            if (!$currentEntry['__dn']) { $this->ldapFail(__FUNCTION__, $this->conn); $currentEntry['+failed'] = true; continue; }
            foreach(self::attrMap as $attr => $_) {
                $value = $this->getLdapValue($this->conn, $entry, $attr);
                if ($value !== null) { $currentEntry[$attr] = $value; }
            }
            $history[] = $currentEntry;
        }
        return $history;
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
        $res = ldap_mod_replace($this->rwconn, $currentEntry['__dn'], $updateCurrenEntry);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->rwconn); return null; }
        return $currentEntry['id'];
    }

    function updateEntry (string $docDn, string $entryId, string $content, array $options = []):?string {
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
        $res = ldap_mod_replace($this->rwconn, $currentEntry['__dn'], $updateCurrent);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->rwconn); return null; }
        return $currentEntry['id']; // update do not change the id
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

    /* Return document DN for given id */
    function getDocumentDn (string $docId, bool $includeDeleted = false, array $options = []):?string {
        $filter = '';

        if ($includeDeleted) {
            $filter = $this->buildFilter('(&(objectclass=kedDocument)(kedId=%s))', $docId);
        } else {
            $filter = $this->buildFilter('(&(objectclass=kedDocument)(kedId=%s)(!(kedDeleted=*)))', $docId);
        }
        if (empty($options['parent'])) {
            $res = @ldap_search($this->conn, $this->base, $filter, [ 'dn' ]);
        } else {
            $res = @ldap_list($this->conn, $options['parent'], $filter, [ 'dn' ]);
        }
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        if ($entriesCount > 1) { $this->logicFail( __FUNCTION__, 'Too many entries'); return null; }
        if ($entriesCount < 1) { return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $dn = @ldap_get_dn($this->conn, $entry);
        if (!$dn) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }

        return $dn;
    }

    function getDn (string $id, bool $includeDeleted = false, array $options = []):?string {
        $filter = '';
        if ($includeDeleted) {
            $filter = $this->buildFilter('(kedId=%s)', $id);
        } else {
            $filter = $this->buildFilter('(&(kedId=%s)(!(kedDeleted=*)))', $id);
        }
        if (empty($options['parent'])) {
            $res = @ldap_search($this->conn, $this->base, $filter, [ 'dn' ]);
        } else {
            $res = @ldap_list($this->conn, $options['parent'], $filter, [ 'dn' ]);
        }
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $entriesCount = @ldap_count_entries($this->conn, $res);
        if ($entriesCount === false) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        if ($entriesCount > 1) { $this->logicFail(__FUNCTION__, 'Too many entries'); return null; }
        if ($entriesCount < 1) { return null; }
        $entry = @ldap_first_entry($this->conn, $res);
        if (!$entry) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $dn = @ldap_get_dn($this->conn, $entry);
        if (!$dn) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }

        return $dn;
    }

    function deleteByDn (string $dn):bool {
        $meta = $this->getMetadata($dn);
        if (empty($meta['deleted'])) {
            $mod = ['kedDeleted' => time() ];
            $res = @ldap_mod_add($this->rwconn, $meta['__dn'], $mod);
            if (!$res) { $this->ldapFail(__FUNCTION__, $this->rwconn); return false; }
            return true;
        }
    }
}

?>