<?php

namespace ked {
    function Format ($in, $type, $filepath = true) {
        switch ($type) {
            default: 
                return new formats\file($in, $filepath);
            case 'text/x-quill-delta':
                return new formats\quillsDelta($in, $filepath);
        }
    }
}

namespace ked\formats {
    require_once __DIR__ . '/vendor/autoload.php';

    class file {
        protected $in;
        protected $filepath;
        protected $medium;
        function __construct ($in, $filepath) {
            $this->in = $in;
            $this->filepath = $filepath;
            $this->medium = 'raw';
        }
        
        function setMedium ($any) {
            $this->medium = $any;
        }

        function get () {
            if ($this->filepath) {
                return fopen($this->in, 'r');
            }
            return $this->in;
        }

        function output () {
            if ($this->filepath) {
                $fp = fopen($this->in, 'r');
                if ($fp) {
                    fpassthru($fp);
                    fclose($fp);
                }
                return;
            }
            file_put_contents('php://output', $this->in);
        }
    }

    class quillsDelta extends file {
        function get () {
            if ($this->medium === 'raw') {
                return parent::get();
            }
            $content = $this->in;
            if ($this->filepath) {
                $content = file_get_contents($this->path);
            }
            if ($content === false) { return ''; }
            $quill = new \DBlackborough\Quill\Render($content, \DBlackborough\Quill\Options::FORMAT_GITHUB_MARKDOWN);
            return $quill->render();
        }

        function output () {
            file_put_contents('php://output', $this->get());
        }
    }
}

