<?php

namespace ked;

require('wesrv/lib/msg.php');

use Exception;

class msg {
    private $message;

    function __construct(string $address = '127.0.0.1', int $port = 8531, string $key = 'ked-demo-key') {
        $this->message = new \wesrv\msg($address, $port, $key);
    }

    function exit($clientid) {
        $this->message->send(
            json_encode([
                'operation' => 'exit',
                'clientid' => $clientid
            ])
        );
    }

    function lock ($id, $clientid) {
        $this->message->send(
            json_encode([
                'operation' => 'lock',
                'id' => $id,
                'clientid' => $clientid
            ])
        );
    }

    function unlock ($id, $clientid) {
        $this->message->send(
            json_encode([
                'operation' => 'unlock',
                'id' => $id,
                'clientid' => $clientid
            ])
        );
    }

    function update ($id, $clientid) {
        $msg = [
            'operation' => 'update',
            'id' => $id
        ];
        if ($clientid !== null) {
            $msg['clientid'] = $clientid;
        }
        $this->message->send(json_encode($msg));
    }

    function delete ($path, $clientid) {
        $msg = [
            'operation' => 'delete',
            'path' => $path
        ];
        if ($clientid === null) {
            $msg['clientid'] = $clientid;
        }
        $this->message->send(json_encode($msg));
    }

    function create($id, $clientid) {
        $msg = [
            'operation' => 'create',
            'id' => $id
        ];
        if ($clientid !== null) {
            $msg['clientid'] = $cliendid;
        }
        $this->message->send(json_encode($msg));
    }
}