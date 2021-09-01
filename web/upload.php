<?php
/* receive slice of a file and reassemble them when all have been transferred.
 * a token is generated elsewhere, a directory with that token name is created
 * at the same time, this script only allow upload if the directory exists. It
 * is a kind of authentication.
 * It has a metadata.json to keep track of the upload and use directory 
 * creation as locking mechanism.
 * A cleanup mechanism might be run by a cronjob or something similar.
 * This upload allows to go over any limit the server sets. Limits are on th
 * client side which must keep the unuploaded part.
 */

define('KED', 1);
require('init.php');

define('MAX_ALLOWED_SIZE', 107374182400); // 100G is quite a lot
if (!isset($KEDConfiguration['upload'])) {
    $KEDConfiguration['upload'] = [
        'path' => '/tmp/',
        'max-upload-size' => MAX_ALLOWED_SIZE
    ];
}
if (!isset($KEDConfiguration['upload']['path'])) {
    $KEDConfiguration['upload']['path'] = '/tmp/';
}
if (!isset($KEDConfiguration['upload']['max-upload-size'])) {
    $KEDConfiguration['upload']['path'] = MAX_ALLOWED_SIZE;
}

header('Content-Type: application/json', true);

function allowed($dir) {
    return !is_dir($dir . '/.forbid');
}

function forbid ($dir) {
    return @mkdir($dir . '/.forbid');
}

function lock ($dir) {
    $i = 0;
    while (!@mkdir($dir . '/.lock')) {
        usleep(50000);
        if(++$i > 20) { return false; }
    }
    return true;
}

function unlock ($dir) {
    return @rmdir($dir . '/.lock');
}

$out = [
    'id' => null,
    'token' => null,
    'duplicate' => false,
    'done' => false    
];

$MAP = [
    'count' => ['HTTP_X_KED_CHUNK_COUNT', 'int'],
    'max' => ['HTTP_X_KED_CHUNK_MAX', 'int'],
    'size' => ['HTTP_X_KED_CHUNK_SIZE', 'int'],
    'filename' => ['HTTP_X_KED_FILENAME', 'str'],
    'filesize' => ['HTTP_X_KED_FILESIZE', 'int'],
    'token' => ['HTTP_X_KED_TOKEN', 'tok'],
    'hash' => ['HTTP_X_KED_HASH', 'tok'],
    'filetype' => ['HTTP_X_KED_FILETYPE', 'str'],
    'path' => ['HTTP_X_KED_PATH', 'str']
];

function fail() {
    $out = [
        'id' => null,
        'duplicate' => false,
        'done' => false    
    ];
    echo json_encode($out);
    exit(0);
}

function ok() {
    global $out;
    echo json_encode($out);
    exit(0);
}

$chunk = [];
foreach ($MAP as $k => $v) {
    switch ($v[1]) {
        case 'tok':
            if (preg_match('/[^a-z0-9]/i', $_SERVER[$v[0]])) { fail(); }
            $chunk[$k] = $_SERVER[$v[0]];
            break;
        case 'str':
            $chunk[$k] = Normalizer::normalize($_SERVER[$v[0]], Normalizer::FORM_C);
            break;
        case 'int':
            if (!is_numeric($_SERVER[$v[0]])) { fail(); }
            $chunk[$k] = intval($_SERVER[$v[0]], 10);
            break;
    }
}

if (!isset($chunk['count']) || empty($chunk['token'])) {
    fail();
}
$chunk['id'] = $chunk['token'] . '-' . str_pad(strval($chunk['count']), 6, '0', STR_PAD_LEFT);
$dir = $KEDConfiguration['upload']['path'] . "/$chunk[token]";

if (!is_dir($dir) || !is_writable($dir)) { fail(); }
if (!allowed($dir)) { fail(); }
$meta = [
    'max' => $chunk['max'],
    'chunksize' => $chunk['size'],
    'current' => 0,
    'filename' => $chunk['filename'],
    'filesize' => $chunk['filesize'],
    'token' => $chunk['token'],
    'filetype' => $chunk['filetype'],
    'hash' => $chunk['hash'],
    'path' => $chunk['path'],
    'parts' => []
];

if (!lock($dir)) { fail(); }
if (is_file($dir . '/metadata.json')) {
    $meta = json_decode(file_get_contents($dir . '/metadata.json'), true);
} else {
    /* first chunk, compute size */
    if ($meta['max'] * $meta['chunksize'] > $KEDConfiguration['upload']['max-upload-size']) {
        error_log('TOO BIG : ' . ($meta['max'] * $meta['chunksize']));
        forbid($dir);
        unlock($dir);
        fail();
    }
}

$out['id'] = $chunk['id'];
$out['token'] = $chunk['token'];

if (isset($meta['parts'][$chunk['count']])) {
    $out['duplicate'] = true;
    unlock($dir);
    ok();
}
$meta['parts'][$chunk['count']] = $chunk;
$meta['current']++;

/* write chunk to file */
$content = file_get_contents('php://input');
$outfile = fopen("/tmp/$meta[token]/$meta[filename]", 'c');
if (!$outfile) {
    unlock($dir);
    fail();
}
if (fseek($outfile, $chunk['count'] * $meta['chunksize'], SEEK_SET) === -1) {
    unlock($dir);
    fail();
}
if (!fwrite($outfile, $content)) {
    unlock($dir);
    fail();
}
fclose($outfile);

file_put_contents($dir . '/metadata.json', json_encode($meta));
if ($meta['current'] === $meta['max']) {
    $endhash = hash_file('sha256', "/tmp/$meta[token]/$meta[filename]");
    if ($meta['hash'] !== $endhash) {
        unlock($dir);
        fail();
    }
    $out['done'] = true;
    $user = new ked\DNUser(file_get_contents("/tmp/$meta[token]/.user"));
    $KEDHigh->setCurrentUser($user);
    $KEDHigh->addBinaryEntry($meta['path'], "/tmp/$meta[token]/$meta[filename]", $meta['filetype'], [
        'ked:name=' . $meta['filename'],
        'ked:size=' . $meta['filesize']
        ] );
}

unlock($dir);
ok();