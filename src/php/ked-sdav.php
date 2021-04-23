<?php
namespace ked;

use Sabre\DAV;

include 'formats.php';


trait kedInode {
    abstract public function _getKed():high;
    abstract public function _getPath():string;
    abstract public function _getMeta():?array;

    function getMeta () {
        $ked = $this->_getKed();
        $dn = $ked->pathToDn($this->_getPath(), false);
        return $ked->getMetadata($dn);
    }

    function uniqueName ($name, $id) {
        $parts = explode('.', $name);
        if (count($parts) > 1) {
            $ext = array_pop($parts);
            $parts[count($parts) - 1] .= ' [id ' . $id . ']';
            $parts[] = $ext;
            return join('.', $parts);
        }
        return $name . ' [id ' . $id . ']';
    }

    function getName() {
        $meta = $this->_getMeta();
        if (empty($meta['+class'])) { return ''; }
        if (isset($meta['name'])) { 
            return $this->uniqueName($meta['name'], $meta['id']); 
        }
        if (isset($meta['application'])) {
            foreach ($meta['application'] as $appData) {
                if (substr($appData, 0, 8) === 'ked:name') {
                    return $this->uniqueName(substr($appData, 9), $meta['id']);
                }
            }
        }
        return $meta['id'];
    }

    function getLastModified() {
        $meta = $this->_getMeta();
        return $meta['modified'] ?? filemtime(__FILE__);
    }

    function childPath ($name) {
        $path = $this->_getPath();
        if (empty($path)) { return $name; }
        return $path . high::PATH_SEPARATOR . $name;
    }
}

class KDirectory extends DAV\Collection {
    use kedInode;
    private $ked;
    private $path;
    private $dn;
    protected $meta;

    function __construct (high $ked, string $path = '', $meta = null) {
        $this->ked = $ked;
        $this->path = $path;
        $this->dn = $this->ked->pathToDn($this->path);
        if (!$this->dn) {
            throw new DAV\Exception('Init failed');
        }
        if ($meta !== null) {
            $this->meta = $meta;
        } else {
            $this->meta = $this->getMeta();
            if (!$this->meta) {
                throw new DAV\Exception('Init failed');
            }
        }
    }

    function _getKed():high { return $this->ked; }
    function _getPath():string { return $this->path; }
    function _getMeta():?array { return $this->meta; }

    function getChildren() {
        $children = [];
        
        $dn = $this->ked->pathToDn($this->path);
        if (!$dn) { throw new DAV\Exception\NotFound('Path '. $this->path . ' is not to be found'); }
        $childs = $this->ked->listDirectory($dn);
        if (!$childs) { return $children; }

        foreach($childs as $child) {
            $children[] = $this->getChild($child['id']);
        }

        return $children;
    }

    function getChild($name) {

        $path = $this->childPath($name);

        $parts = explode(high::PATH_SEPARATOR, $path);
        foreach($parts as &$part) {
            if (preg_match('/.*\[id ([^\]]+)\].*/', $part, $matches)) {
                $part = $matches[1];
            }
        }
        $path = implode(high::PATH_SEPARATOR, $parts);

        $dn = $this->ked->pathToDn($path, false);
        if (!$dn) {
            $dn = $this->ked->searchDnByAny($name);
        }
        if (!$dn) { throw new DAV\Exception('Can\'t load'); }

        $meta = $this->ked->getMetadata($dn);
        if (in_array('document', $meta['+class']) || empty($meta['+class'])) {
            return new KDirectory($this->ked, $this->ked->dnToPath($meta['__dn']), $meta);
        } else {
            return new KFile($this->ked, $this->ked->dnToPath($meta['__dn']), $meta);
        }
        
    }

    function childExists ($name) {
        if ($this->ked->pathToDn($this->childPath($name), false)) {
            return true;
        }
        return false;
    }
}

class KFile extends DAV\File {
    use kedInode;
    private $path;
    private $ked;
    protected $meta;
    private $dn;

    function _getKed():high { return $this->ked; }
    function _getPath():string { return $this->path; }
    function _getMeta():?array { return $this->meta; }
    
    function __construct (high $ked, string $path, $meta = null) {
        $this->ked = $ked;
        $this->path = $path;
        $this->dn = $this->ked->pathToDn($this->path, false);
        if (!$this->dn) {
            throw new DAV\Exception('Init failed');
        }
        if ($meta !== null) {
            $this->meta = $meta;
        } else {
            $this->meta = $this->getMeta();
            if (!$this->meta) {
                throw new DAV\Exception('Init failed');
            }
        }
    }
    
    function get() {
        if (isset($this->meta['contentRef'])) {
            $path = $path = $this->ked->getFilePath($this->meta['contentRef']);
            if (!is_readable($path)) { return ''; }
            $format = Format($path, $this->meta['type']);
            $format->setMedium('dav');
            return $format->get();
        }
        $object = $this->ked->getAll($this->path, false);
        if ($object) {
            $format = Format($object['content'], $this->meta['type'], false);
            $format->setMedium('dav');
            return $format->get();
        }
        throw new DAV\Exception('Unreadable');
    }

    function getSize() {
        if (isset($this->meta['contentRef'])) {
            $filepath = $this->ked->getFilePath($this->meta['contentRef']);
            if (is_readable($filepath)) {
                return filesize($filepath);
            }
        } else {
            return strlen($this->get());
        }

        return 0;
    }

    function getETag() {
        if (isset($this->meta['contentRef'])) {
            return $this->meta['contentRef'];
        } else {
            return '"' . md5($this->get()) . '"';
        }
    }
}