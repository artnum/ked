<?php

namespace ked;

use Exception;

class msg {
    private $socket;
    private $address;
    private $port;
    private $key;

    function __construct(string $address = '127.0.0.1', int $port = 8531, string $key = 'ked-demo-key') {
        $this->address = $address;
        $this->port = $port;
        $this->auth = new msgAuth($key);

        $this->socket = socket_create(AF_INET, SOCK_DGRAM, SOL_UDP);
        if (!$this->socket) { throw new Exception('Socket creation failed'); }
        socket_set_nonblock($this->socket);
    }

    function __destruct() {
        socket_close($this->socket);
    }

    function exit($clientid) {
        $this->msg('exit:' . $clientid);
    }

    function lock ($id, $clientid) {
        $this->msg('lock:' . $id . '\\' . $clientid);
    }

    function unlock ($id, $clientid) {
        $this->msg('unlock:' . $id . '\\' . $clientid);
    }

    function update ($id, $clientid) {
        if ($clientid === null) {
            $this->msg('update:' . $id);
        } else {
            $this->msg('update:' . $id . '\\' . $clientid);
        }
    }

    function delete ($path, $clientid) {
        if ($clientid === null) {
            $this->msg('delete:' . $path);
        } else {
            $this->msg('delete:' . $path . '\\' . $clientid);
        }
    }

    function create($id, $clientid) {
        if ($clientid === null) {
            $this->msg('create:' . $id);
        } else {
            $this->msg('create:' . $id . '\\' . $clientid);
        }
    }

    function msg($msg) {
        $msg = $this->auth->sign($msg);
        socket_sendto($this->socket, $msg, strlen($msg), 0, $this->address, $this->port);
    }
}

class  msgAuth {
    private $key;

    function __construct(string $key) {
        $this->key = $key;    
    }

    function sign ($msg) {
        $length = strlen($msg);
        $sig = hash_hmac('sha1', $msg, $this->key);
        return sprintf("%s:%d@%s", $sig, $length, $msg);
    }

    function verify ($msg) {
        if (strpos($msg, '@') === -1) { return false; }
        $parts = explode('@', $msg);
        if (count($parts) !== 2) { return false; }
        $sigparts = explode(':', $parts[0]);
        if (count($sigparts) !== 2) { return false; }
        $payload = substr($parts[1], 0, intval($sigparts[1]));
        $sig = $this->sign($payload);
        if ($sig !== $msg) { return false; }
        return $payload;
    }
}