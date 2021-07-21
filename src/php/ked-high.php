<?PHP
declare(strict_types=1);
namespace ked;

use Exception;
use Imagick;
use DateTime;

class high extends ked {
    /* direct key on my keyboard ... tired of shift-7 for path separator 
     * Also, it has no meaning in HTTP, base64, base36, ... and almost 
     * everything used on the web. It won't get translated by http server.
     */
    const PATH_SEPARATOR = ',';
    protected $store = null;
    protected $maxTextSize = 20480;
    protected $inlinePicture = true;
    protected $locker = null;

    function disableInlinePicture() {
        $this->inlinePicture = false;
    }
    
    function enableInlinePicture() {
        $this->inlinePicture = false;
    }

    function setMaxTextSize (int $size) {
        if ($size >= 0) {
            $this->maxTextSize = $size;
        }
    }
    function setStore (string $path):bool {
        if (is_writeable($path)) {
            $this->store = $path;
            return true;
        }
        return false;
    }

    function setLocker (state $locker) {
        $this->locker = $locker;
    }

    function createStorePath (string $path):bool {
        $dirpath = dirname($path);
        if (!is_dir($dirpath)) {
            return @mkdir($dirpath, 0775, true);
        }
        return true;
    }

    function hash ($content, $isFile = false) {
        $ctx = sodium_crypto_generichash_init('');
        if (!$isFile) {
            sodium_crypto_generichash_update($ctx, $content);
        } else {
            $fp = fopen($content, 'r');
            while (($part = fread($fp, 4096))) {
                sodium_crypto_generichash_update($ctx, $part);
            }
            fclose($fp);
        }

        return sodium_bin2hex(sodium_crypto_generichash_final($ctx));
    }

    function getFilePath (string $hash):string {
        return sprintf('%s/%s/%s/%s', $this->store, substr($hash, 0, 2), substr($hash, 2, 2), $hash);
    }

    function listDirectory (
        ?string $path,
        bool $extended = false,
        array $options = ['deleted' => false, 'archived' => false],
        array $limits = [-1, -1]
    ):?array {
        $currentDir = $this->base;
        if ($path !== null) {
            $currentDir = $path;
        }
    
        $options = array_merge(['deleted' => false, 'archived' => false], $options);
        $filterOption = '';
        if (!$options['archived']) { $filterOption .= '(!(kedArchived=*))'; }
        if (!$options['deleted']) { $filterOption .= '(!(kedDeleted=*))'; }

        $res = @ldap_list(
            $this->conn,
            $currentDir,
            $filterOption !== '' ? '(&(objectClass=kedDocument)' . $filterOption . ')' : '(objectClass=kedDocument)',
            [ 'dn' ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return null; }
        $documents = [];
        for ($entry = @ldap_first_entry($this->conn, $res); $entry; $entry = @ldap_next_entry($this->conn, $entry)) {
            $docDn = @ldap_get_dn($this->conn, $entry);
            if (!$docDn) { $this->ldapFail($this->conn); continue; }
            if ($this->acl) {
                if (!$this->acl->can($this->currentUser, 'access', $docDn)) { continue; }
            }
            $documents[] = $this->getDocument($docDn);
        }
        /* specify attribute to avoir reading content while listing */
        $res = @ldap_list(
            $this->conn,
            $currentDir,
            '(&(objectClass=kedEntry)(!(kedNext=*))' . $filterOption . ')',
            [
                'objectClass',
                'kedTimestamp',
                'kedId',
                'kedContentType',
                'kedNext',
                'kedDeleted',
                'kedModified',
                'kedSignature',
                'kedApplication',
                'kedContentReference',
                'kedArchived'
            ],
            0,
            $limits[0],
            $limits[1]
        );
        if (!$res) { $this->ldapFail($this->conn); return null; }
        for ($entry = @ldap_first_entry($this->conn, $res); $entry; $entry = @ldap_next_entry($this->conn, $entry)) {
            $object = $this->getLdapObject($this->conn, $entry);
            if ($this->locker) {
                $object['+lock'] = $this->locker->islocked($object['dn']);
            }
            $h = $this->getEntryHistory($currentDir, $object['id']);
            $object['+history'] = [];
            foreach ($h as $_h) {
                $object['+history'][] = $this->filterConvertResult($_h);
            }
            $object = $this->filterConvertResult($object);
            $documents[] = $object;
        }

        return $documents;
    }

    function filterConvertResult (array $entry) {
        $keys = array_keys($entry);
        foreach ($keys as $k) {
            if (substr($k, 0, 2) === '__') { 
                unset($entry[$k]); 
            }
            switch ($k) {
                case 'dn':
                    $entry['abspath'] = $this->dnToPath($entry['dn']);
                    unset($entry['dn']);
                    break;
                case 'deleted':
                case 'modified':
                case 'created':
                case 'taskEnd':
                case 'taskDone':
                case 'archived':
                    $entry[$k] = (new DateTime("@$entry[$k]"))->format('c');
                    break;
            }
        }
        return $entry;
    }

    /* The deeper you go, the slower it gets. But the tree of document is made
     * made by people, so it won't too deep. 
     */
    function pathToDn (string $path, bool $docOnly = true):?string {
        if ($path === '') { return $this->base; }
        $elements = explode(self::PATH_SEPARATOR, $path);
        $currentDir = $this->base;
        foreach ($elements as $dir) {
            $hpart = explode('-', $dir, 2);
            $currentDir = $this->getActiveDn($hpart[0], ['parent' => $currentDir, 'timestamp' => $hpart[1] ?? null, 'document' => $docOnly]);
            if ($currentDir === null)  { return null; }
        }
        return $currentDir;
    }

    function searchDnByAny (string $path):?string {
        if ($path === '' || $path === '[root]') { return $this->base; }
        $elements = explode(self::PATH_SEPARATOR, $path);
        $currentDir = $this->base;
        foreach ($elements as $fname) {
            /* first by dn */
            $newCurrentDir = $this->getDnByName($fname, $currentDir);
            if ($newCurrentDir === null) {
                $hpart = explode('-', $fname, 2);
                $newCurrentDir = $this->getActiveDn($hpart[0], ['parent' => $currentDir, 'timestamp' => $hpart[1] ?? null]);
            } 
            if ($newCurrentDir === null) { return null;}
            $currentDir = $newCurrentDir;
        }
        return $currentDir;
    }

    /* return basic info on path */
    function getInfo (string $path, $filter = true):?array {
        $dn = $this->pathToDn($path, false);
        if ($dn === null) { return null; }
        $metadata = $this->getMetadata($dn);
        if (empty($metadata['+class'])) {
            /* root */
            $metadata['+class'] = [ 'root', 'document' ];
            $metadata['name'] = '[root]';
        }
        $metadata['+childs'] = $this->countDocumentChilds($dn);
        $metadata['+entries'] = $this->countDocumentEntries($dn);
        if ($filter) { $metadata = $this->filterConvertResult($metadata); }
        return $metadata;
    }

    function getAll (string $path, $filter = true):?array {
        $dn = $this->pathToDn($path, false);
        if ($dn === null) { return null; }
        $data = parent::getAll($dn);
        if (empty($data['+class'])) {
            $data['+class'] = [ 'root', 'document' ];
            $data['name'] = '[root]';
        }
        if ($filter) { $data = $this->filterConvertResult($data); }
        return $data;
    }

    function dnToPath (string $dn, bool $parent = false):string {
        if ($dn === '') { return ''; }
        $path = [];
        $comp = explode(',', $dn);
        $base = explode(',', $this->base);

        while (($c1 = array_pop($base))) {
            $c2 = array_pop($comp);
            if (!$c2) { return ''; }
            if ($c1 !== $c2) { return ''; }
        }
        if ($parent) { array_shift($comp); }
        if (empty($comp)) { return ''; }
        while (($c = array_pop($comp))) {
            $sub = explode('+', $c);
            $x = '';
            foreach ($sub as $s) {
                if (substr($s, 0, 6) === 'kedId=') { $x = $s; break; }
            }
            if ($x === '') { return ''; }
            $path[] = substr($x, 6);
        }
        return implode(self::PATH_SEPARATOR, $path);
    }

    function idFromPath (string $path):string {
        $elements = explode(self::PATH_SEPARATOR, $path);
        return array_pop($elements);
    }

    function addDocument (string $name, ?string $parent, $application = null, $tags = []) {
        $options = [];
        if ($application !== null) {
            if (is_array($application)) {
                foreach ($application as &$app) {
                    if (!is_scalar($app)) { return null; }
                    $app = (string) $app;
                }
            } else {
                if (!is_scalar($application)) { return null; }
                $application = (string) $application;
            }
            $options['application'] = $application;
        }
        if ($parent !== null) {
            if ($parent === null) { return null; }
            $options['parent'] = $parent;
        }
        $tagsDn = [];
        foreach ($tags as $tag) {
            $object = $this->findTag($tag);
            if (!$object) { continue; }
            $tagsDn[] = $object['dn'];
        }
        if (!in_array($this->rootTag['dn'], $tagsDn)) {
            $tagsDn[] = $this->rootTag['dn'];
        }
        $options['tags'] = $tagsDn;
        $dn = $this->createDocument($name, $options);
        return $this->dnToPath($dn);
    }

    function getDocument (string $docDn, $extended = false):array {
        $document = parent::getDocument($docDn);

        if ($this->locker) {
            $document['+lock'] = $this->locker->islocked($document['dn']);
        }

        $document['+childs'] = $this->countDocumentChilds($document['dn']);
        if ($extended) {
            $document['+entries'] = $this->listDocumentEntries($document['dn']);
            foreach ($document['+entries'] as $k => $child) {
                $child['abspath'] = $this->pathToDn($child['dn']);
                $document['+entries'][$k] = $this->filterConvertResult($child);
            }
        } else {
            $document['+entries'] = $this->countDocumentEntries($document['dn']);
        }
       
        $document['+history'] = [];
        $document = $this->filterConvertResult($document);

        return $document;
    }

    function getEntry (string $entryDn) {
        $entry = $this->getCurrentEntryByDn($entryDn);
        if ($entry) {
            $entry = $this->filterConvertResult($entry);
        }
        return $entry;
    }

    function search(string $term, $limits = [-1, -1]) {
        $tags = $this->searchTags($term, $limits);     
        $result = $this->findByTags($tags, $limits);
        $result2 = $this->findDocuments($term, $limits);
        foreach ($result2 as $doc) {
            $result['documents'][] = $this->filterConvertResult($doc);
        }

        return $result['documents'];
    }

    function findByTags(array $tags, $limits = [ -1, -1 ]):array {
        $objects = parent::findByTags($tags, $limits);
        $frontObjects = ['documents' => [], 'entries' => [], 'tags' => []];
        foreach ($objects as $object) {
            if (in_array('kedDocument', $object['objectclass'])) {
                $document = $this->getDocument($object['dn']);
                if ($document) {
                    $frontObjects['documents'][] = $document;
                }
                continue;
            }
            if (in_array('kedEntry', $object['objectclass'])) {
                $entry = $this->getCurrentEntryByDn($object['dn']);
                if ($entry) {
                    $frontObjects['entries'][] = $entry;
                }
                continue;
            }
            if (in_array('kedTag', $object['objectclass'])) {
                $tag = $this->getTagName($object['dn']);
                if ($tag) {
                    $frontObjects['tags'][] = $tag;
                }
                continue;
            }
        }
        return $frontObjects;
    }

    function anyToTask (string $path, array $details = []):bool {
        $anyDn = $this->pathToDn($path, false);
        if ($anyDn === null) { return false; }
        $params = [];

        if (!empty($details['previous'])) {
            $prevDn = $this->pathToDn($details['previous']);
            if ($prevDn === null) { return false; }
            $params['taskPrevious'] = $prevDn;
        }
        if (!empty($details['end'])) {
            try {
                $endDt = new DateTime($details['end']);
            } catch(Exception $e) {
                return null;
            }
            $params['taskEnd'] = $endDt->format('U');
        }
        if (!empty($details['done'])) {
            try {
                $doneDt = new DateTime($details['done']);
            } catch(Exception $e) {
                return null;
            }
            $params['taskDone'] = $doneDt->format('U');
        }
        if (!$this->addClasses($anyDn, ['kedTask'])) { return false; }
        return $this->updateInPlaceAny($anyDn, $params);
    }

    function anyToNotTask (string $path):bool {
        $anyDn = $this->pathToDn($path, false);
        if ($anyDn === null) { return false; }
        $this->removeClasses($anyDn, ['kedTask']);
        return true;
    }

    function updateTask (string $path, $params):bool {
        $docInfo = $this->getInfo($path, false);
        if (!in_array('task', $docInfo['+class'])) { return false; }
        $updateValues = [];
        foreach ($params as $k => $v) {
            switch ($k) {
                case 'taskDone':
                case 'taskEnd':
                    if (empty($v)) { $updateValues['-' . $k] = ''; continue 2; }
                    try {
                        $dt = new DateTime($v);
                    } catch (Exception $e) {
                        return false;
                    }
                    $updateValues[$k] = $dt->format('U');
                    break;
            }
        }
        return $this->updateInPlaceAny($docInfo['dn'], $updateValues);
    }

    /**** UPDATE and ADD functions should be kind of fuse together ****/
    function updateTextEntry (string $path, string $text, string $type = 'text/plain', $application = null):?string {
        $entryDn = $this->pathToDn($path, false);
        if ($entryDn === null) { return null; }

        $textSize = strlen($text);
        if ($textSize <= $this->maxTextSize) {
            return $this->dnToPath($this->updateEntryByDn($entryDn, $text, ['type' => $type]));
        } else {
            $hash = $this->hash($text);
            $filepath = $this->getFilePath($hash);
            if (!$this->createStorePath($filepath)) { return null; }
            if (!file_exists($filepath)) {               
                $written = file_put_contents($filepath, $text);
                if (!$written) { return null; }
                if ($written < $textSize) { return null; }
            }
            $subtext = '';
            switch ($type) {
                /* default split to a space near the end if possible */
                default:
                case 'text/plain':
                    $subtext = mb_substr($text, 0, $this->maxTextSize, 'UTF-8');
                    $lastSpace = mb_strripos($subtext, ' ', 0, 'UTF-8');
                    /* last space is near the end of the text */
                    if ($lastSpace !== false && $lastSpace + 100 >= $this->maxTextSize) {
                        $subtext = mb_substr($subtext, 0, $lastSpace, 'UTF-8');
                    }
                    break;                    
            }
            return $this->dnToPath($this->updateEntryByDn($entryDn, $subtext, ['type' => $type, 'contentRef' => $hash, 'application' => $application]));
        }
    }

    /* works with utf8 */
    function addTextEntry (string $path, string $text, string $type = 'text/plain', $application = null):?string {
        $docDn = $this->pathToDn($path);
        if ($docDn === null) { return null; }

        $textSize = strlen($text);
        if ($textSize <= $this->maxTextSize) {
            return $this->dnToPath($this->createEntry($docDn, $text, ['type' => $type]));
        } else {
            $hash = $this->hash($text);
            if (!$this->createFile($text, $hash)) { return null; }
            $subtext = '';
            switch ($type) {
                /* default split to a space near the end if possible */
                default:
                case 'text/plain':
                    $subtext = mb_substr($text, 0, $this->maxTextSize, 'UTF-8');
                    $lastSpace = mb_strripos($subtext, ' ', 0, 'UTF-8');
                    /* last space is near the end of the text */
                    if ($lastSpace !== false && $lastSpace + 100 >= $this->maxTextSize) {
                        $subtext = mb_substr($subtext, 0, $lastSpace, 'UTF-8');
                    }
                    break;                    
            }
            return $this->dnToPath($this->createEntry($docDn, $subtext, ['type' => $type, 'contentRef' => $hash, 'application' => $application]));
        }
    }

    function moveFile (string $file, string $hash):bool {
        $filepath = $this->getFilePath($hash);
        if (!$this->createStorePath($filepath)) { return false; }
        if (file_exists($filepath)) {
            @unlink($file);
        } else {
            if (!rename($file, $filepath)) { return false; }
        }
        return true;
    }

    function createFile (string $content, string $hash, bool $preview = false):bool {
        $filepath = $this->getFilePath($hash);
        if ($preview) { $filepath .= '.preview'; }
        if (!$this->createStorePath($filepath)) { return false; }
        if (file_exists($filepath)) { return true; }
        $written = file_put_contents($filepath, $content);
        if (!$written) { return false; }
        if ($written !== strlen($content)) { @unlink($filepath); return false; }
        return true;
    }

    function updateBinaryEntry (string $path, string $file, string $filetype = 'application/octet-stream',  array $application = []):?string {
        $entryDn = $this->pathToDn($path, false);
        if ($entryDn === null) { return null; }
        if (!$this->store) { return null; }

        $hash = $this->hash($file, true);
        if (!$this->moveFile($file, $hash)) { return null; }

        return $this->dnToPath($this->updateEntryByDn($entryDn, null, ['type' => $filetype, 'contentRef' => $hash, 'application' => $application]));
    }

    function addBinaryEntry (string $path, string $file, string $filetype = 'application/octet-stream',  array $application = []):?string {
        $docDn = $this->pathToDn($path);
        if ($docDn === null) { return null; }
        if (!$this->store) { return null; }
        
        $hash = $this->hash($file, true);
        if (!$this->moveFile($file, $hash)) { return null; }

        return $this->dnToPath($this->createEntry($docDn, null, [ 'type' => $filetype, 'contentRef' => $hash, 'application' => $application ]));
    }

    function isSupportedImage (string $file):bool {
        $formats = Imagick::queryFormats(); 
        try {
            $im = new Imagick($file);
            if (!in_array($im->getImageFormat(), $formats)) { return false; }
        } catch (Exception $e) {
            return false;
        }
        return true;
    }

    function convertImageToContent (string $file):?array {
        $content = null;
        $hash = $this->hash($file, true);
        try {
            /* generate a thumbnail 400x400 max */
            $im = new Imagick($file);
            switch ($im->getImageOrientation()) {
                case Imagick::ORIENTATION_TOPLEFT:
                    break;
                case Imagick::ORIENTATION_TOPRIGHT:
                    $im->flopImage();
                    break;
                case Imagick::ORIENTATION_BOTTOMRIGHT:
                    $im->rotateImage("#000", 180);
                    break;
                case Imagick::ORIENTATION_BOTTOMLEFT:
                    $im->flopImage();
                    $im->rotateImage("#000", 180);
                    break;
                case Imagick::ORIENTATION_LEFTTOP:
                    $im->flopImage();
                    $im->rotateImage("#000", -90);
                    break;
                case Imagick::ORIENTATION_RIGHTTOP:
                    $im->rotateImage("#000", 90);
                    break;
                case Imagick::ORIENTATION_RIGHTBOTTOM:
                    $im->flopImage();
                    $im->rotateImage("#000", 90);
                    break;
                case Imagick::ORIENTATION_LEFTBOTTOM:
                    $im->rotateImage("#000", -90);
                    break;
                default: // Invalid orientation
                    break;
            }
            $im->setImageOrientation(Imagick::ORIENTATION_TOPLEFT);

            $imageType = $im->getImageMimeType();
            $size = $im->getSize();
            $im->setImageFormat('jpeg');
            $im->setImageCompressionQuality(40);
            $im->stripImage();
            if ($size['columns'] > $size['rows']) {
                $im->thumbnailImage(200, 400, true);
            } else {
                $im->thumbnailImage(400, 200, true);
            }
            if ($this->inlinePicture) {
                $content = base64_encode($im->getImageBlob());
            } else {
                $this->createFile($im->getImageBlob(), $hash, true);
            }
            $im->clear();
        } catch (Exception $e) {
            $this->logicFail($e->getMessage());
            return null;
        }

        if (!$this->moveFile($file, $hash)) { return null; }

        return [ 'raw' => $content, 'contentRef' => $hash, 'type' => $imageType ];
    }

    function _imageEntry (string $file, array $application = []):?array {
        $img = $this->convertImageToContent($file);
        if ($img === null) { return null; }
        $content = null;
        if ($img['raw']) { $content = $img['raw']; unset($img['raw']); }
        $options = $img;
        $options['application'] = $application;
        return [$content, $options];        
    }

    function addImageEntry (string $path, string $file, array $application = []):?string {
        $docDn = $this->pathToDn($path);

        if ($docDn === null) { return null; }
        if (!$this->store) { return null; }
        
        $imgEntry = $this->_imageEntry($file, $application);
        if ($imgEntry === NULL) { return null; }

        return $this->dnToPath($this->createEntry($docDn, $imgEntry[0], $imgEntry[1]));
    }

    function updateImageEntry (string $path, string $file, array $application = []):?string {
        $entryDn = $this->pathToDn($path, false);

        if ($entryDn === null) { return null; }
        if (!$this->store) { return null; }

        $imgEntry = $this->_imageEntry($file, $application);
        if ($imgEntry === NULL) { return null; }

        return $this->updateEntryByDn($entryDn, $imgEntry[0], $imgEntry[1]);
    }

    function addDocumentTag (string $path, string $tag) {
        $tagObject = $this->findTag($tag);
        if (!$tagObject) { return null; }
        $docDn = $this->pathToDn($path, false);
        return $this->addTag($docDn, $tagObject['dn']);
    }

    function removeDocumentTag (string $path, $tags) {
        if (!is_array($tags)) {
            $tagObject = $this->findTag($tags);
            if (!$tagObject) { return false; }
            $docDn = $this->pathToDn($path, false);
            if (!$docDn) { return false; }
            return $this->removeTag($docDn, $tagObject['dn']);
        }
        $tagsDn = [];
        foreach ($tags as $tag) {
            $tagObject = $this->findTag($tag);
            if (!$tagObject) { return false; }
            $tagsDn[] = $tagObject['dn'];
        }
        $docDn = $this->pathToDn($path, false);
        if (!$docDn) { return false; }
        return $this->removeTags($docDn, $tagsDn);
    }
}

?>