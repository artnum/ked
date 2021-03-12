<?PHP
namespace ked;

use Normalizer;
use Exception;

class http {
    protected $ked;
    function __construct(high $ked)
    {
        $this->ked = $ked;
        $this->responseStarted = false;
    }

    function responseHeaders() {
        header('Allow: GET, POST, HEAD');
        header('Accept-Charset: utf-8');
        header('Accept: application/json');
    }

    function errorUnsupportedMethod () {
        $this->responseHeaders();
        http_response_code(405);
        exit();
    }

    function errorBadRequest () {
        $this->responseHeaders();
        http_response_code(400);
        exit();
    }

    function errorBodyContent () {
        $this->responseHeaders();
        http_response_code(406);
        exit();
    }

    function errorUnableToOperate() {
        $this->responseHeaders();
        http_response_code(500);
        exit();
    }

    function errorNotFound () {
        $this->responseHeaders();
        http_response_code(404);
        exit();
    }

    function printDir ($dir, $childs) {
        header('Content-Type: text/html');
        $root = false;
        if (in_array('root', $dir['+class'])) { $root = true; }

        $this->ok('<!DOCTYPE html><html><head><title>Index of ' . $dir['name'] . '</title><style>');
        $this->ok('.header span, .entry span { min-width: 34ch; max-width: 34ch; text-overflow: ellipsis; display: inline-block; }');
        $this->ok('.type { max-width: 16px; min-width: 16px !important; width: 16px; }');
        $this->ok('.childs { max-width: 8ch; min-width: 8ch !important; width: 8ch; }');  
        $this->ok('.created, .deleted { max-width: 28ch; min-width: 28ch !important; width: 28ch; }');  
        $this->ok('</style></head><body><h1>Index of '. $dir['name'] . '</h1>');
        $this->ok('<div class="header"><span class="type"><i></i></span><span class="name">Name</span><span class="childs">Childs</span>');
        $this->ok('<span class="created">Created</span><span class="modified">Modified</span></span></div>');
        $this->ok('<hr>');
        if (!$root) {
            $parent = $this->ked->dnToPath($dir['__dn'], true);
            $this->ok('<div class="entry"><span class="type"><i class="parent"> </i></span>');
            $this->ok('<span class="name"><a href="' . (empty($parent) ? str_replace($_SERVER['PATH_INFO'], '', $_SERVER['REQUEST_URI']) : $parent) . '">[parent]</a></span>');
            $this->ok('<span class="childs"></span>');
            $this->ok('<span class="created"></span>');
            $this->ok('<span class="modified"></span>');
            $this->ok('</div>');

        }
        foreach ($childs as $child) {
            $class = 'file';
            if (in_array('event', $child['+class'])) {
                $class = 'event';
            } else if (in_array('task', $child['+class'])) {
                $class = 'task';
            } else if (in_array('document', $child['+class'])) {
                $class = 'directory';
            }
            $this->ok('<div class="entry"><span class="type"><i class="' . $class . '"> </i></span>');
            $this->ok('<span class="name"><a href="' . ($root ? basename($_SERVER['REQUEST_URI']) . '/' : $this->ked->dnToPath($dir['__dn']) . ',') . $child['id'] . '">' . $child['name'] . '</a></span>');
            $this->ok('<span class="childs">' . ($child['+childs'] + $child['+entries']) . '</span>');
            $this->ok('<span class="created">' . $child['created'] . '</span>');
            $this->ok('<span class="modified">' . $child['modified'] . '</span>');
            $this->ok('</div>');
        }
        $this->ok('</body></html>');
    }

    function ok (string $txt) {
        if (!$this->responseStarted) {
            $this->responseHeaders();
            http_response_code(200);
            $this->responseStarted = true;
        }
        echo Normalizer::normalize($txt, Normalizer::FORM_C);
    }

    function run () {
        $method = strtolower($_SERVER['REQUEST_METHOD']);
        switch ($method) {
            /* apache like display */
            case 'get':
                $path = '';
                if (!empty($_SERVER['PATH_INFO'])) { $path = str_replace('/', '', $_SERVER['PATH_INFO']); }
                $info = $this->ked->getInfo($path);
                if ($info === null) { $this->errorNotFound(); }
                if (in_array('document', $info['+class'])) {
                    $childs = $this->ked->listDirectory($info['__dn']);
                    $this->printDir($info, $childs);
                }
                break;
            /* post is the api access */
            case 'post':
                $body = file_get_contents('php://input');
                if (empty($body)) { $this->errorBadRequest(); }
                $body = Normalizer::normalize($body, Normalizer::FORM_C);
                if ($body === false) { $this->errorBodyContent(); }
                $body = json_decode($body, true);
                if ($body === null) { $this->errorBodyContent(); }
                if (empty($body['operation'])) { $this->errorBadRequest(); }
                $this->postOperation($body);
                break;
            case 'head':
                break;
            default:
                $this->errorUnsupportedMethod();
                break;
        }
    }

    function postOperation (array $body) {
        switch ($body['operation']) {
            default:
                $this->errorBadRequest();
                break;
            case 'create-document':
                $parent = null;
                if (empty($body['name'])) {
                    $this->errorBadRequest();
                }
                if (!empty($body['path'])) {
                    $parent = $this->ked->pathToDn($body['path']);
                    if ($parent === null) { $this->errorNotFound(); }
                }
                $application = null;
                if (!empty($body['application'])) {
                    $application = $body['application'];
                }
                $id = $this->ked->addDocument($body['name'], $parent, $application);
                if ($id === null) { $this->errorUnableToOperate(); }
                $this->ok(json_encode(['id' => $id]));
                break;
            case 'list-document':
                $parent = null;
                if (!empty($body['path'])) {
                    $parent = $this->ked->pathToDn($body['path']);
                    if ($parent === null) { $this->errorNotFound(); }
                }
                $documents = $this->ked->listDirectory($parent);
                if ($documents === null) { $this->errorUnableToOperate(); }
                $this->ok(json_encode(['documents' => $documents]));
                break;
            case 'get-document':
                if (empty($body['path'])) { $this->errorBadRequest(); }
                $docDn = $this->ked->pathToDn($body['path']);
                if ($docDn === null) { $this->errorNotFound(); }
                $document = $this->ked->getDocument($docDn);
                $this->ok(json_encode($document));
                break;
        }
    }
}

?>