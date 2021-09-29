<?php
require('../web/conf/ked.php');
require('wesrv/lib/client.php');

$client = new \wesrv\client(
    $KEDConfiguration['message'][0]['address'],
    $KEDConfiguration['message'][0]['port'],
    $KEDConfiguration['message'][0]['key']
);
$client->watch();