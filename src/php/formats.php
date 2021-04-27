<?php

namespace ked {
    function Format ($in, $type, $filepath = true) {
        switch ($type) {
            default: 
                return new formats\file($in, $filepath);
            case 'text/x-quill-delta':
                return new formats\quillsDelta($in, $filepath);
            case 'application/pdf':
                return new formats\pdf($in, $filepath);
        }
    }
}

namespace ked\formats {

use Exception;

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

    class pdf extends file {
        function get () {
            if ($this->medium !== 'preview') {
                return parent::get();
            }
            if (!$this->filepath) { return parent::get(); }
            try {
                $img = new \Imagick();
                $img->readImage($this->in . '[0]');
                $img->setResolution(300, 300);
                $img->setImageFormat('png');
                return $img->getImagesBlob();
            } catch (\Exception $e) {
                return parent::get();
            }
        }
        function output() {
            if ($this->medium === 'preview') {
                header('Content-Type: image/png', true);
            }
            file_put_contents('php://output', $this->get());
        }
    }

    class quillsDelta extends file {
        function get () {
            if ($this->medium === 'raw') {
                return parent::get();
            }
            $content = $this->in;
            if ($this->filepath) {
                $content = file_get_contents($this->in);
            }
            if ($content === false) { return ''; }
            switch($this->medium) {
                default: return $content;
                case 'dav':
                case 'md':
                    $qrender = new \DBlackborough\Quill\Render($content, \DBlackborough\Quill\Options::FORMAT_GITHUB_MARKDOWN);
                    break;
                case 'browser':
                case 'html':
                    $qrender = new \DBlackborough\Quill\Render($content);
                    break;
            }
            return $qrender->render();
        }

        function output () {
            file_put_contents('php://output', $this->get());
        }
    }
}

