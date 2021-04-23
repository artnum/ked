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
            $delta = json_decode($content, true);
            if ($delta === null) { return ''; }
            $outcontent = '';
            $bullet = null;
            $currentline = '';
            foreach ($delta['ops'] as $ops) {
                if (isset($ops['insert'])) {
                    if (!empty($ops['attributes'])) {
                        foreach(array_keys($ops['attributes']) as $attr) {
                            switch ($attr) {
                                case 'header': 
                                    $str = str_repeat('#', $ops['attributes'][$attr]) . ' ';
                                    if (strchr($ops['insert'], "\n")) {
                                        $currentline = $str . $currentline;   
                                    }
                                    break;
                                case 'list':
                                    if ($ops['attributes'][$attr] === 'bullet') {
                                        $bullet = '* ';
                                    } else {
                                        if ($bullet === null) {
                                            $bullet = 1;
                                        } else {
                                            $bullet++;
                                        }
                                    }
                                    $str = '    ' . ($bullet === '* ' ? $bullet : strval($bullet) . ' ');
                                    if (strchr($ops['insert'], "\n")) {
                                        $currentline = $str . $currentline;   
                                    }
                                    break;

                            }
                        }
                    }
                    if (strchr($ops['insert'], "\n")) {
                        $outcontent .= $currentline . $ops['insert'];
                    } else {
                        $currentline = $ops['insert'];
                    }
                }
            }    
            return $outcontent;
        }

        function output () {
            file_put_contents('php://output', $this->get());
        }
    }
}

