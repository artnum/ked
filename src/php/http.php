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
            case 'get':
                if (!empty($_SERVER['PATH_INFO'])) {
                    $this->ok("request $_SERVER[PATH_INFO]");
                }
                break;
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
        }
    }
}

?>