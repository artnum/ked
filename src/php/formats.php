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
            case 'message/rfc822':
                return new formats\rfc822($in, $filepath);
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
            if ($this->medium === 'browser' && $this->filepath) {
                if (is_file($this->in . '.preview')) {
                    return fopen($this->in . '.preview', 'r');
                }
            }
            if ($this->filepath) {
                return fopen($this->in, 'r');
            }
            return $this->in;
        }

        function output () {
            if ($this->filepath) {
                $fp = $this->get();
                if ($fp) {
                    fpassthru($fp);
                    fclose($fp);
                }
                return;
            }
            file_put_contents('php://output', $this->in);
        }
    }

    class rfc822 extends file {
        function get () {
            if ($this->medium !== 'browser') {
                return parent::get();
            }

            if ($this->filepath) { $mime = mailparse_msg_parse_file($this->in); }
            else { 
                $mime = mailparse_msg_create();
                mailparse_msg_parse($mime, $this->in);
            }

            $structure = mailparse_msg_get_structure($mime);
            $message = ['subject' => '', 'from' => '', 'to' => '', 'date' => '', 'text' => '', 'html' => ''];
            foreach ($structure as $part) {
                $r = mailparse_msg_get_part($mime, $part);
                $data = mailparse_msg_get_part_data($r);
                if (!isset($data['headers'])) { continue; }
                foreach ($data['headers'] as $k => $v) {
                    switch ($k) {
                        case 'subject':
                        case 'from':
                        case 'to':
                        case 'date':
                            $message[$k] = $v; break;
                        case 'content-type':
                            if (strpos($v, 'text/html') === 0) {
                                if ($this->filepath) {
                                    $message['html'] .= trim(mailparse_msg_extract_part_file($r, $this->in, null));
                                } else {
                                    $message['html'] .= trim(mailparse_msg_extract_part($r, $this->in, null));
                                }
                            }
                            if (strpos($v, 'text/plain') === 0) {
                                if ($this->filepath) {
                                    $message['text'] .= trim(mailparse_msg_extract_part_file($r, $this->in, null));
                                } else {
                                    $message['text'] .= trim(mailparse_msg_extract_part($r, $this->in, null));
                                }
                            }
                            break;
                    }
                }
            }
            mailparse_msg_free($mime);
            $output = '<!DOCTYPE html><html><head><title>' . $message['subject'] . '</title><head><body><div class="mail-header">';
            $output .= '<div class="date">' . $message['date'] . '</div>';
            $output .= '<div class="from">' . $message['from'] . '</div>';
            $output .= '<div class="to">' . $message['to'] . '</div>';
            $output .= '</div>';
            if (!empty($message['html'])) {
                $output .= '<div class="mail-content">' . $message['html'] . '</div>';
            } else if (!empty($message['text'])) {
                $output .= '<pre class="mail-content">' . $message['text'] . '</pre>';
            }
            $output .= '</body></html>';
            return $output;
        }
        function output() {
            if ($this->medium === 'browser') {
                header('Content-Type: text/html', true);
            }
            file_put_contents('php://output', $this->get());
        }
    }

    class pdf extends file {
        function get () {
            if ($this->medium !== 'browser') {
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
            if ($this->medium === 'browser') {
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

