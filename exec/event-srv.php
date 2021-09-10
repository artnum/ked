<?php
require('../web/conf/ked.php');
require('wesrv/lib/msg.php');
require('wesrv/lib/srv.php');

$srv = new wesrv\srv(
    $KEDConfiguration['message'][0]['address'],
    $KEDConfiguration['message'][0]['port'],
    $KEDConfiguration['message'][0]['address'],
    $KEDConfiguration['message'][0]['port'],
    $KEDConfiguration['message'][0]['key']
);
$srv->run();
