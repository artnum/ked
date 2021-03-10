<?PHP

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

    function createStorePath (string $path):bool {
        $dirpath = dirname($path);
        if (!is_dir($dirpath)) {
            return @mkdir($dirpath, 0775, true);
        }
        return true;
    }

    function getFilePath (string $hash):string {
        return sprintf('%s/%s/%s/%s', $this->store, substr($hash, 0, 2), substr($hash, 2, 2), $hash);
    }

    function listDirectory (?string $path):?array {
        $currentDir = $this->base;
        if ($path !== null) {
            $currentDir = $path;
        }
        $res = @ldap_list($this->conn, $currentDir, '(&(objectClass=kedDocument)(!(kedDeleted=*)))', [ '*' ]);
        if (!$res) { $this->ldapFail(__FUNCTION__, $this->conn); return null; }
        $documents = [];
        for ($entry = @ldap_first_entry($this->conn, $res); $entry; $entry = @ldap_next_entry($this->conn, $entry)) {
            $object = $this->getLdapObject($this->conn, $entry);
            $object['+childs'] = $this->countDocumentChilds($object['__dn']);
            $object['+entries'] = $this->countDocumentEntries($object['__dn']);
            $this->filterConvertResult($object);
            $documents[] = $object;
        }
        return $documents;
    }

    function filterConvertResult (array &$entry) {
        $keys = array_keys($entry);
        foreach ($keys as $k) {
            if (substr($k, 0, 2) === '__') { unset($entry[$k]); }
            switch ($k) {
                case 'deleted':
                case 'modified':
                case 'created':
                case 'taskEnd':
                case 'taskDone':
                    $entry[$k] = (new DateTime("@$entry[$k]"))->format('c');
                    break;
            }
        }
    }

    function pathToDn (string $path):?string {
        $elements = explode(self::PATH_SEPARATOR, $path);
        $currentDir = $this->base;
        foreach ($elements as $dir) {
            $currentDir = $this->getDocumentDn($dir, false, ['base' => $currentDir]);
            if ($currentDir === null)  { return null; }
        }
        return $currentDir;
    }

    function addDocument (string $name, ?string $parent, $application = null) {
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
        return $this->createDocument($name, $options);
    }

    /* works with utf8 */
    function addTextEntry (string $docId, string $text, string $type = 'text/plain'):?string {
        $textSize = strlen($text);
        if ($textSize <= $this->maxTextSize) {
            return $this->createEntry($docId, $text, ['type' => $type]);
        } else {
            /* no need for crypto sercure hash */
            $hash = sha1($text);
            $filepath = $this->getFilePath($hash);
            if (!$this->createStorePath($filepath)) { return null; }
            $written = file_put_contents($filepath, $text);
            if (!$written) { return null; }
            if ($written < $textSize) { return null; }
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
            return $this->createEntry($docId, $subtext, ['type' => $type, 'contentRef' => $hash]);
        }
    }

    function addImageEntry (string $docId, string $file):?string {
        if (!$this->store) { return null; }
        $content = '';

        try {
            /* generate a thumbnail 400x400 max */
            $im = new Imagick($file);
            $imageType = $im->getImageMimeType();
            if ($this->inlinePicture) {
                $size = $im->getSize();
                $im->setImageFormat('jpeg');
                $im->setImageCompressionQuality(40);
                $im->stripImage();
                if ($size['columns'] > $size['rows']) {
                    $im->thumbnailImage(200, 400, true);
                } else {
                    $im->thumbnailImage(400, 200, true);
                }
                $content = base64_encode($im->getImageBlob());
            }
            $im->clear();
        } catch (Exception $e) {
            $this->logicFail(__FUNCTION__, $e->getMessage());
            return null;
        }

        /* no need for crypto secure hash, sha1 is good enough */
        $hash = sha1_file($file);
        $filepath = $this->getFilePath($hash);
        if (!$this->createStorePath($filepath)) { return null; }
        if (!rename($file, $filepath)) { return null; }

        return $this->createEntry($docId, $content, [ 'type' => $imageType, 'contentRef' => $hash ]);
    }
}

?>