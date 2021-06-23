<?PHP
namespace ked;

require ('formats.php');
require ('ked-acl.php');
require ('ked-state.php');

use Normalizer;

class http {
    protected $ked;
    protected $msg;
    protected $acl;
    protected $user;
    protected $clientid;
    protected $requestid;
    function __construct(high $ked, msg $msg = null)
    {
        $this->ked = $ked;
        $this->msg = $msg;
        $this->requestid = null;
        $this->clientid = null;
        $this->acl = new ACL($this->ked);
        $this->states = new state($this->ked->getBase(), $this->ked->getLdapConn(true));
        $this->ked->setLocker($this->states);
        $this->responseStarted = false;
        $this->user = null;
        $this->userStore = null;
        $this->configuration = [
            'disable-file-upload' => false,
            'disable-apache-browse' => false,
            'disable-task' => false
        ];
        $this->outputType = '';
        $this->processHeaders();
    }

    function config(string $name, $value = null) {
        if ($value === null) {
            if (!isset($this->configuration[$name])) { return null; }
            return $this->configuration['name'];
        }
        $this->configuration[$name] = $value;
        return $this->configuration[$name];
    }

    function processHeaders () {
        if (!empty($_SERVER['HTTP_X_CLIENT_ID'])) {
            $this->clientid = $_SERVER['HTTP_X_CLIENT_ID'];
        }
        if (!empty($_SERVER['HTTP_X_REQUEST_ID'])) {
            $this->requestid = $_SERVER['HTTP_X_REQUEST_ID'];
        }
    }

    function config_merge($config) {
        foreach ($config as $k => $v) {
            $this->configuration[$k] = $v;
        }
        return;
    }

    function setUserStore($userstore) {
        $this->userStore = $userstore;
    }

    function setUser($user) {
        $this->user = $user;
    }

    function responseHeaders() {
        header('Allow: GET, POST, HEAD');
        header('Accept-Charset: utf-8');
        header('Accept: application/json');
        header('Cache-Control: no-store', true);
        switch($this->outputType) {
            case 'json':
                header('Content-Type: application/json', true); break;
            case 'html':
                header('Content-Type: text/html', true); break;
            case 'text':
                header('Content-Type: text/plain', true); break;
        }
    }

    function setJsonOut () {
        $this->outputType = 'json';
    }

    function setHtmlOut() {
        $this->outputType = 'html';
    }

    function setTextOut() {
        $this->outputType = 'text';
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
        $this->logTrace();
        $this->responseHeaders();
        http_response_code(500);
        exit();
    }

    function errorNotFound () {
        $this->responseHeaders();
        http_response_code(404);
        exit();
    }

    function errorForbidden() {
        $this->responseHeaders();
        http_response_code(403);
        exit();
    }

    function logTrace () {
        $traces = debug_backtrace();
        while ($trace = array_shift($traces)) {
            if ($trace['function'] === 'logTrace') { continue; }
            break;
        }
        error_log('[Respond Error Begin]');
        do {
            error_log("<$trace[function]> $trace[file]:$trace[line] ");
        } while($trace = array_shift($traces));
        error_log('[Respond Error End]');
    }

    function getBaseName () {
        $base = $_SERVER['REQUEST_URI'];
        if (basename($_SERVER['SCRIPT_NAME']) !== basename($base)) {
            $base .= substr($base, -1) === '/' ? basename($_SERVER['SCRIPT_NAME']) : '/' . basename($_SERVER['SCRIPT_NAME']);
        }
        return $base;
    }

    function printDir ($dir, $childs) {
        $this->setHtmlOut();
        $root = false;
        if (in_array('root', $dir['+class'])) { $root = true; }

        $this->ok('<!DOCTYPE html><html><head><title>Index of ' . $dir['name'] . '</title><style>');
        $this->ok('.header span, .entry span { min-width: 42ch; max-width: 42ch; text-overflow: ellipsis; display: inline-block; }');
        $this->ok('.type, .type i { max-width: 16px; min-width: 16px !important; width: 16px; min-height: 16px; max-height: 16px; height: 16px; display: inline-block; }');
        $this->ok('.childs, .events, .tasks { max-width: 8ch; min-width: 8ch !important; width: 8ch; }');
        $this->ok('.entry { line-height: 2.8ex; }');  
        $this->ok('.history { margin-left: 2ch; color: gray; }');
        $this->ok('.history a { color: lightblue; }');
        $this->ok('.created, .deleted { max-width: 28ch; min-width: 28ch !important; width: 28ch; }');
        $this->ok('.type i.directory { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAAOdEVYdFRpdGxlAEZvbGRlcnMhVKpgQQAAABd0RVh0QXV0aG9yAExhcG8gQ2FsYW1hbmRyZWnfkRoqAAAAKXRFWHREZXNjcmlwdGlvbgBCYXNlZCBvZiBKYWt1YiBTdGVpbmVyIGRlc2lnbqCEBXMAAAGuSURBVDiNpZG/alRBFMZ/M3v3T0xioltsCguFSCIiaBmICGJjIWhaO4s0LvgAgr0PoM8gKBJfQEUbURAjKirEwhVUNCxmvffOnZl7jsUmq0U2cPGDYeCcMz++M59RVf5Hpnvx2DWsvQmm+W9DVfsqrN5ae3NvT8DVS8e3zq2sTteSOlKWiAxPng548XgtC0W+dPvB+9fjAIkxTIgKH9efjYoNUzDX3GRpcXIfTK7fubG86+NBrg8TiyH7vTUq1kzgYPKTo6evMNOZH2s9+oznd6+fTdozDeN7j2iXDoB6a5rF5cu09nf41vswFtA5NE+IQtI+0KydOt9lanYOABUhHfTp/+ixV0IxOHwUkjJEGhOzfPn0duzwbvLOEaKS+CiEIqeMoRIgFPnQQYiCdxkx+EqAwqXDPwhRKFxOGao58Hk2BPigFC4lVlzB5Sk+6M4KjrKMGMywa3bGDLCdxCgQRYHCbTuIiuR5ZhutKayxGFvD2r+3qqJSIiKIlKgKIsKvze9ERRKR2pONdy/PHF44Yaigr583VMU+Nd0LC0dss3k/BH+yCqBeb7ySolj5A0Ys6Y3vGnPVAAAAAElFTkSuQmCC); }');
        $this->ok('.type i.parent { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAATdEVYdFRpdGxlAE9wdGljYWwgRHJpdmU+Z7oMAAACA0lEQVQ4jWP8//8/Ay7Q2dPmzfCPoe8/I8NLxn//K8rLq4+hq2HCpbmrqz2Em4tnQ1pahpqPp48tAxPjRGzqWHBp5uLhXp4Yn8TCysrGwMLCzMDwn+EbNrUYLkDX/Oz5E4Zde3b/YfjP0EbQAGyaN23e9OfHt++R5eVVO7H69f///wz///9n6OxsC5k8deLvL18+///58+f/+w/u/p84uf93Z2dbCEwNNszCwMDA0NbWHMbNy70UbvOzxwzrN67/8/Xb18iayvo1/RN7G//+/VPMzMzSW5hfXI/MZ6pprZH9/efXIitLKxZWVjYGBgYGhh07tzN8+vhxak1l/RoGBgaGv3//FJcUlXP//funGJ3PfGjvoU+79+669fjx40A5WTkmPj5+Bm1tXYZz58+abNux9bqzk+u1k6dOsh89dtiEmZml19LC6gAyH+6XsrLikIamut937t76//Pnz/+fP3/639TS8LusrBhvGKBwCopzQ2pqq37fuXMTbkhdfc3vguJcnIZgCGTlZoWUV5b+vn37BtyQyury35m5md7YDMBISFMnTV3z4d37yBkzZ/55+PA+AysrK0NsdCzL3z+/+4hKiQwMDAwzZsxe8+7D28gp06b+uXr1MsPrN28Yfv/6/RKbWkZ8uTEuLtr9PxNDFSMDA9d/pn/5i+ctx8iNeA0gBgAABBZ17IHKRIMAAAAASUVORK5CYII=); }');
        $this->ok('.type i.file { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAASdEVYdFRpdGxlAFBhcGVyIFNoZWV0c7mvkfkAAAAXdEVYdEF1dGhvcgBMYXBvIENhbGFtYW5kcmVp35EaKgAAACd0RVh0RGVzY3JpcHRpb24Ad2l0aCBhIEhVR0UgaGVscCBmcm9tIEpha3VihlQHswAAAkhJREFUOI2Fk89LVFEUxz/nzZtyFtmMKSnRIohWRYuKtBG1Nv2AClpE1n9gSG1cVAhtCiKIMEgswskspR8kKLpxFeNUf0el6ajDqJXjffeeFs+nowYdOPceLpfP+Z5z7hVVZWRs6KyI9Fjr9oKiqqgCKMAfkHHnbNeli5fH2WyqytDw++9z87PqnNviKyslnZz6ocOjQ78H372+FcLX3QMolUp7Uskqln4tUVwoMFfIMzM7xeTPb0znp1goFjl3+nyiprqms38g01EuwAMwJgDAWkNvb4aXmT76+l7R3/8GExhmZqfxPI+WplOJ7dsq7r7IPGuMAH4IMAAENuDqtVastVhnsTZYi99+GKQinuDQwcOJidynDiC7BgiMARRrLdlsFnWKU4t1jqPHjlBbV0sqlSSwDs/zZHl5+cyTp49j7W037ZoCXW1off1xnCrqHM6F2VWERCKBiLB/3wFGx0ZiTl0ciADBhskIoAKIIOLh+154LkKU0Kkr60FgoqHy5fNXlA3vYM0aGuqJ7qvTrU0EjxPpBnRVRbSub2EQBAHOuo0AATzPo/PObQrFRQBSO3dw7/4DcrkcAOl0mqhkZ205IAAE349RKC4ycCUPQOsg+H6cpubmUIEKIkJgDLYcEKyWEIv5VCcraR0MJVcnK/F9n4nsRKigMVJgsJtLAIh5MR4+6kJE1h2h5WRL1ON/A0RkqlCYr6uq2sX/bGGhCMi8CUwpLEuV9hvXL/hxv9usrOxWBUVh9UuXx6DE49vyxpi2nu7nHwH+Amz1X9YNE8s/AAAAAElFTkSuQmCC); }');
        $this->ok('.type i.video { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAMySURBVDiNjZJNTFxlFIaf+81w7zAz/AxlBhAMNY2gQoNFMrYarUpoMLGugEaaujKNQXBhWBhjaJtGoxDbmBaNGuPCBFOQGttFS/0hWhQXLKyKKQwZwfJTZi6dgcLM3Lk/nwuklp0nOYs3OXnOyfseRUrJ3dXW1uZHOEdz3Gq7lE6l7dgBNUdNCOGaS2dSAzji48HBwfWteeVuwKFDLQdzNHVgZ+VOEQoVe6urHqCmppboXzMsLC4yE4luTE1fl6aRbT937suL2wCtL7Q2FhftuNjxckfu1PQUoWAxV779hmg0SkFBAZ2dneR6fOh6jDNnz6YyWeP5oS+GvnNvbfd6PCe6X+vOvTRyiatXf6R+Tz2trS3E9Rh+Xx6Tf0wyfH6Y5uZmnn7mKe/o6OgJ4D9AxjAayssruH/XLpoaG5GKxHJMpJT4832EHw1Tu7sWfSWGR/MyMnKlAUBsAUzLMhYW5kmurdFz/BjD54e5tZJASnC7VHrf7aOzs4vI9AzpdAYppQFw54KbsRXt9Pun6X2nl5oHH0L1aJw69R6zs3NUVVXT9WoXWcOgrKycY8d7uBm7pW0zsX7vvrF7y0KPBwIFPPnEfg40HSAYDKGqKqtrSebmZvllfJyx8Z/JSD9lJUXm0t+R5+4A6sLhRpdwXWjYU+vN9WhksxbpVIp0Jo3b5cKRkEwmSSilVIQCVJbmcyM6eW3bH9SFwweFcA9UlJcp9XU1vpKSEB6PRlxfYXFhicnrkY3EbUPxF5QMhUqDe1fmI9VK+5HD0pdXyGYH8OUVItwqsbhOPK4T13Wylo2UYNo2pmmTNbMIt4pmLG+m8MkH/YjSR3jrzW4AXn/lRZR7wnze/zYA18a/J3jfw+hL8wiXi9y8IoRwAcq00n7ksAxU70f1BsjR8im0bpDw78a2TExjg8hPwwSrHyObTmFk1lme/RMtbwfrq3G0zPLJzRgdQEqk4myaIR0QAhTxr3Q2pZQ4js3tRBwp7cuZpH5SAPT3HAUc+jqeBaDvpX2gCM50NQFw4cM3MDNpfv3hK4QQVja1+pnliJaJiQnzf5loOTJmW87vFvzm2PKjsa8/ndpK7h90v3hkNyzwLAAAAABJRU5ErkJggg==); }');
        $this->ok('.type i.text { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAASdEVYdFRpdGxlAFBhcGVyIFNoZWV0c7mvkfkAAAAXdEVYdEF1dGhvcgBMYXBvIENhbGFtYW5kcmVp35EaKgAAACd0RVh0RGVzY3JpcHRpb24Ad2l0aCBhIEhVR0UgaGVscCBmcm9tIEpha3VihlQHswAAAhNJREFUOI11kstqU1EUhr91ctI2A2uTNsRaOxDEkeILiIgTL6CCAx+iUnTSgQPBRxAFSxWhA8XiBQst7aQjUV+kMWlzOaeJVZvsy3JwctK0wQWLvQabb/3/v7eoKuubqzdFZMk5PwuKqqIKoAB/Qba8d8/v3b2/xfFSVVbXPpWbUUO990Pd7Xa0Uv2paxurf1Y+vnucwA87AOh0OjP5iQL7v/dptWOacZ1ao0plZ5vdepV2q8Wt67dzxanik7fvlxcGBQQAxlgAqpUK5e0KO5Ua9d2IuNlmL/pFuVwhCAKuXrmWGx0Ze/pm+dXlFBAmAANAYSqPcy5p73DO4pwjE8OHzyuMZXNcvHAp9/3H1wXgWx9gjQGURi3CWjuU01S+xMkTBbxYgiCQg4ODGy9ePsvMzz1yfQUKTBTGcc7iVVHv8T5V4hhhFJExzp09z8bmesarzwIpINkaN1s454YUpCWBkC706gcysEkG+clxnPNo7y/0PsMhQHoAa1CvwyFCQBAoipBcFY4eyWCtxTt/FCBAHO3h7P8tZMIMpeI0xlh8z+pABkLpVBG0J1UGVKQKVBARrDH9rAaeERq1iG63298YhiFnZmf63rWXiTEGd9wCwOmZaUTkaA8ooJfpEEBEqnEcTRcKk//1n1a73QIkMtZ0EluqzD98cCfMhoum2y2pgpI84fEZlGx2pG6MmVtafP0F4B+wR1eZMTEGTgAAAABJRU5ErkJggg==); }');
        $this->ok('.type i.image { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAIdSURBVDiNpZPNS5RRFMZ/9537OuO8zmCOUyDkqg8tkFxViyIKIlftBMMWRYsiEkRwGW1qG4Qw/4LIrNqEgRh9LWrQiCwb04WCYpngNPPmveN7Twt1XCRJeJaXcx7O77nnUSLCfkp/mv4wLiIX9moUEZxziBOcOJxzIIzx8fOEOOfkfyuKInn1dlw0gFKK0efPMMbsubJSCr+ujiuXuzDWoqMoAiAMQzZWi7sOeZ6H58VQykMp2Gg6AoA1Fs8aC4CxBh2V0VEZMSUKk9MsLi5RH4tQzlKvIzRVErFNHwCsNXjW2i01gy8VfKkQaMP5UwdJ13u8KMwQhhUqYciX2SVWVtfwfX9LwOKZbQFriUuFhFonqTfQVFleKeHHFEdbUjQmY3z/8ZPWA9WaV5sIdgch6f0m0FUCHZEJFBc7mpgqzjM/N82joRG62i2BjojH41szFr3tgbWWZHydlo5jZNtOglRZnprk+mm4/fAp+QdnyWZSJFIBq3oHQVtrdgRYI3u8FS/WCMChE210TBWohGUOZwNy72KUwgU6O79SLv+iXCobvY0A0J0rQS731zd2njnH/dE0QaLKzVs3eP3yDbNz33C43hpCQ0OKa91Xdz2cTKaZ5kwzxZkihfcTmHVDOpXuGegfzGtjLSLC3Tv3/nmBACP5YRYW5kmn0j19ff3DABph7MnQ40vObQakFppdUqpQBqF3oH8wX3vbb5z/AMKPS3t4k9uVAAAAAElFTkSuQmCC); }');
        $this->ok('.type i.audio { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAItSURBVDiNpZI9aBRhEIaf+Xb3Lnu7SYwJuZiggkhE7CyihZ2QQoIgGIxG1EIwqI2FjYKkEqysVQQLO9FSGwVBLCzURgshYCTmTEwuudzf7t3ufmMRK8nZZMoZ3od34BFVZTtjtpUG3K2WF6/veiLCYVUMog4qgqhRiyNgVBBQBzUrWwKyTM9MTBzvGuwfpSccIfD78bwQYxyytEXcrlCPlnj4+P7AlgCAocHdFHyfMAzpDoqE/jA5r5u4VabWWKDghyBoR0ClNk9iq7STGvVmiXyuF8EhSRu0kg1a7XWwKh0BSdrg+Yt39ahpBatiFQOIqhovb9LJ0+O+VdsZAEq1koYp7l7cpO1mXpoSJTF+0h2nG2pB/9dA1SIiPHtQWtB/ZJmeKWI1Q1Hp6IHVFBCdnUU637WzSNamiMDbDrJZm2D17wvTM4MnPM/cck1wxMsXxPWcTCVFQEdLyNSV4njOlbtBoW+fiHFc11irMSjinr06ci7vmUenTk4WRvcfoxGVWC5/dNZrcyhQM0M3Bnb03rkwdTPY2TdMI1rmV/kD1cbcJiBn7OUDh4JCrF/49mORuLVG1FrFbJZTg709dnRP8Lv6hqVKStQukyQNjPFQMK6i77/PRWM9PaXAD5ZJE0u9nlGvNbHWGteTlcXFn925rkREDK24RXmtSXm1mQBGVJXz14r3jMqlzGq/IInjyryin7K2vgT96njmaZbpQWOkrVYzxzWf08S+xphXfwBrnhE3TbuG6AAAAABJRU5ErkJggg==); }');
        $this->ok('.type i.pdf { background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAN1wAADdcBQiibeAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAASdEVYdFRpdGxlAFBhcGVyIFNoZWV0c7mvkfkAAAAXdEVYdEF1dGhvcgBMYXBvIENhbGFtYW5kcmVp35EaKgAAACd0RVh0RGVzY3JpcHRpb24Ad2l0aCBhIEhVR0UgaGVscCBmcm9tIEpha3VihlQHswAAAkhJREFUOI2Fk89LVFEUxz/nzZtyFtmMKSnRIohWRYuKtBG1Nv2AClpE1n9gSG1cVAhtCiKIMEgswskspR8kKLpxFeNUf0el6ajDqJXjffeeFs+nowYdOPceLpfP+Z5z7hVVZWRs6KyI9Fjr9oKiqqgCKMAfkHHnbNeli5fH2WyqytDw++9z87PqnNviKyslnZz6ocOjQ78H372+FcLX3QMolUp7Uskqln4tUVwoMFfIMzM7xeTPb0znp1goFjl3+nyiprqms38g01EuwAMwJgDAWkNvb4aXmT76+l7R3/8GExhmZqfxPI+WplOJ7dsq7r7IPGuMAH4IMAAENuDqtVastVhnsTZYi99+GKQinuDQwcOJidynDiC7BgiMARRrLdlsFnWKU4t1jqPHjlBbV0sqlSSwDs/zZHl5+cyTp49j7W037ZoCXW1off1xnCrqHM6F2VWERCKBiLB/3wFGx0ZiTl0ciADBhskIoAKIIOLh+154LkKU0Kkr60FgoqHy5fNXlA3vYM0aGuqJ7qvTrU0EjxPpBnRVRbSub2EQBAHOuo0AATzPo/PObQrFRQBSO3dw7/4DcrkcAOl0mqhkZ205IAAE349RKC4ycCUPQOsg+H6cpubmUIEKIkJgDLYcEKyWEIv5VCcraR0MJVcnK/F9n4nsRKigMVJgsJtLAIh5MR4+6kJE1h2h5WRL1ON/A0RkqlCYr6uq2sX/bGGhCMi8CUwpLEuV9hvXL/hxv9usrOxWBUVh9UuXx6DE49vyxpi2nu7nHwH+Amz1X9YNE8s/AAAAAElFTkSuQmCC); }');
        $this->ok('</style></head><body><h1>Index of '. $dir['name'] . '</h1>');
        $this->ok('<div class="header"><span class="type"><i></i></span><span class="name">Name</span><span class="tasks">Tasks</span><span class="events">Events</span><span class="childs">Childs</span>');
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
            $file = true;
            if (in_array('document', $child['+class'])) {
                $class = 'directory';
                $file = false;
            } else if (!empty($child['type'])) {
                $mimeparts = explode('/', $child['type']);
                switch($mimeparts[0]) {
                    case 'text': $class = 'file text'; break;
                    case 'image': $class = 'file image'; break;
                    case 'video': $class = 'file video'; break;
                    case 'audio': $class = 'file audio'; break;
                }
                switch ($child['type']) {
                    case 'application/pdf': $class = 'file pdf'; break;
                }
                if (!empty($child['application'])) {
                    foreach ($child['application'] as $application) {
                        if (substr($application, 0, 8) === 'ked:name') {
                            $child['name'] = substr($application, 9);
                        }
                    }
                }
            }
            $event = false;
            $task = false;
            if (in_array('event', $child['+class'])) {
                $event = true;
            } 
            if (in_array('task', $child['+class'])) {
                $task = true;
            }
            $this->ok('<div class="entry"><span class="type"><i class="' . $class . '"> </i></span>');
            if (!$file) {
                $this->ok('<span class="name"><a href="' . ($root ? $this->getBaseName() . '/' : $this->ked->dnToPath($dir['__dn']) . ',') . $child['id'] . '">' . ($child['name'] ?? $child['id']) . '</a></span>');
            } else {
                $this->ok('<span class="name"><a href="' . ($root ? $this->getBaseName() . '/' : $this->ked->dnToPath($dir['__dn']) . ',') . $child['id'] . '?format=browser">' . ($child['name'] ?? $child['id']) . '</a></span>');
            }
            $this->ok('<span class="tasks">' . ($task ? '+' : '') . '</span>');
            $this->ok('<span class="events">' . ($event ? '+' : '') . '</span>');
            $this->ok('<span class="childs">' . (!$file ? ($child['+childs'] + $child['+entries']) : '') . '</span>');
            $this->ok('<span class="created">' . $child['created'] . '</span>');
            $this->ok('<span class="modified">' . $child['modified'] . '</span>');
            $this->ok('</div>');
            for ($i = 0; $i < count($child['+history']); $i++) {
                $c = $child['+history'][$i];
                $this->ok('<div class="entry history"><span class="type"><i class="' . $class . '"> </i></span>');
                $this->ok('<span class="name"><a href="' . ($root ? $this->getBaseName() . '/' : $this->ked->dnToPath($dir['__dn']) . ',') . $c['id'] . '?format=browser">' . ($child['name'] ?? $child['id']) . '</a></span>');
                $this->ok('<span class="tasks"></span>');
                $this->ok('<span class="events"></span>');
                $this->ok('<span class="childs"></span>');
                $this->ok('<span class="created">' . $c['created'] . '</span>');
                $this->ok('<span class="modified">' . $c['modified'] . '</span>');
                $this->ok('</div>');
            }
        }
        $this->ok('</body></html>');
    }

    function ok (?string $txt) {
        if (!$this->responseStarted) {
            $this->responseHeaders();
            http_response_code(200);
            $this->responseStarted = true;
        }
        if (empty($txt) || $txt === null) { return; }
        echo Normalizer::normalize($txt, Normalizer::FORM_C);
    }

    function run () {
        $method = strtolower($_SERVER['REQUEST_METHOD']);
        switch ($method) {
            /* apache like display */
            case 'get':
                $path = '';
                $medium = '';
                if (!empty($_SERVER['PATH_INFO'])) {
                    $path = str_replace('/', '', $_SERVER['PATH_INFO']);
                    $parts = explode('!', $path, 2);
                    if (isset($parts[1])) {
                        $path = $parts[0];
                        $medium = $parts[1];
                    }
                }
                $info = $this->ked->getAll($path, false);
                if (!$this->acl->can($this->user, 'access', $info['__dn'])) { $this->errorForbidden(); }
                if ($info === null) { $this->errorNotFound(); }
                if (in_array('document', $info['+class'])) {
                    if ($this->config('disable-apache-browse')) {
                        $this->errorForbidden();
                    }
                    $childs = $this->ked->listDirectory($info['__dn']);
                    $this->printDir($info, $childs);
                } else {
                    if (!empty($info['contentRef'])) {
                        $filePath = $this->ked->getFilePath($info['contentRef']);
                        if (is_readable($filePath)) {
                            header('Content-Type: ' . $info['type']);
                            $this->ok(null);
                            $formatted = Format($this->ked->getFilePath($info['contentRef']), $info['type']);
                            if (!empty($medium)) {
                                $formatted->setMedium($medium);
                            }
                            $formatted->output();
                        } else {
                            $this->errorNotFound();
                        }
                    } else {
                        $this->ok(null);
                        $formatted = Format($info['content'], $info['type'], false);
                        if (isset($_GET['format'])) {
                            $formatted->setMedium($_GET['format']);
                        }
                        $formatted->output();
                    }
                }
                break;
            /* post is the api access */
            case 'post':
                $body = null;
                if (!empty($_POST['operation'])) {
                    // formdata
                    $body = [];
                    foreach ($_POST as $k => $v) {
                        $body[$k] = Normalizer::normalize($v, Normalizer::FORM_C);
                    }
                    if (!empty($body['_filename'])) {
                        foreach ($_FILES as $file) {
                            if ($file['name'] === $body['_filename']) {
                                unset($body['_filename']);
                                $body['_file'] = $file;
                                break;
                            }
                        }
                    }
                } else {
                    // json body
                    $body = file_get_contents('php://input');
                    if (empty($body)) { 
                        $this->errorBadRequest();
                    }
                    $body = Normalizer::normalize($body, Normalizer::FORM_C);
                    if ($body === false) { $this->errorBodyContent(); }
                    $body = json_decode($body, true);
                }
                if ($body === null) { $this->errorBodyContent(); }
                if (empty($body['operation'])) { $this->errorBadRequest(); }
                /* body path in PATH_INFO is logical */
                if (!isset($body['path'])) {
                    if (!empty($_SERVER['PATH_INFO'])) { $body['path'] = str_replace('/', '', $_SERVER['PATH_INFO']); }
                }
                $this->setJsonOut();
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
            case 'get-user':
                if (!method_exists($this->user, 'toJson')) { $this->errorUnableToOperate(); }
                $this->ok($this->user->toJson());
                break;
            case 'search':
                $limit = 100;
                if (!isset($body['term']) || empty($body['term']) || $body['term'] === null) {
                    $this->errorBadRequest();
                }
                $documents = $this->ked->search($body['term']);
                if (!$documents) { $documents = []; }
                $this->ok(json_encode(['documents' => $documents]));
                break;
            case 'list-tags':
                $limit = 100;
                if (!empty($body['maxsize']) && is_numeric(($body['maxsize'])))  {
                    $limit = intval($body['maxsize']);
                }
                $tags = $this->ked->listTags([$limit, -1]);
                if (!$tags) { $tags = []; }
                $this->ok(json_encode(['tags' => $tags]));
                break;
            case 'search-tags':
                $limit = 50; // search 50 tags
                if (empty($body['expression'])) {
                    $this->errorBadRequest();
                }
                if (!empty($body['maxsize']) && is_numeric(($body['maxsize'])))  {
                    $limit = intval($body['maxsize']);
                }
                $tags = $this->ked->searchTags($body['expression'], [$limit, -1]);
                if (!$tags) { $tags = []; }
                $this->ok(json_encode(['tags' => $tags]));
                break;
            case 'create-tag':
                if (empty($body['name'])) {
                    $this->errorBadRequest();
                }
                $related = [];
                if (!empty($body['related'])) {
                    if (!is_array($body['related'])) { $related = [ $body['related'] ]; }
                    else { $related = $body['related']; }
                }
                $tag = $this->ked->createTag($body['name'], $related); 
                if (!$tag) { $this->errorUnableToOperate(); }
                $this->ok(json_encode(['id' => $tag['kedidname'][0]]));
                break;
            case 'search-by-tags':
                if (empty($body['tags'])) {
                    $this->errorBadRequest();
                }
                $objects = $this->ked->findByTags($body['tags']);

                $this->ok(json_encode($objects));
                break;
            case 'add-document-tag':
                if (empty($body['tag'])) {
                    $this->errorBadRequest();
                }
                if (empty($body['path'])) {
                    $this->errorBadRequest();
                }
                $id = $this->ked->addDocumentTag($body['path'], $body['tag']);
                if ($id === null) { $this->errorNotFound(); }
                if ($this->msg) { $this->msg->update($id, $this->clientid); }
                $this->ok(json_encode(['id' => $id]));
                break;
            case 'create-document':
                $parent = null;
                if (empty($body['name'])) {
                    $this->errorBadRequest();
                }
                if (isset($body['path'])) {
                    $parent = $this->ked->pathToDn($body['path']);
                    if ($parent === null) { $this->errorNotFound(); }
                }
                if (!$this->acl->can($this->user, 'create:sub', $parent ?? '')) { $this->errorForbidden(); }
                $application = null;
                if (!empty($body['application'])) {
                    $application = $body['application'];
                }
                $tags = [];
                if (!empty($body['tags'])) {
                    if (!is_array($body['tags'])) {
                        $tags = [$body['tags']];
                    } else {
                        $tags = $body['tags'];
                    }
                }
                $id = $this->ked->addDocument($body['name'], $parent, $application, $tags);
                if ($id === null) { $this->errorUnableToOperate(); }
                if ($this->msg) { $this->msg->create($this->ked->idFromPath($id), $this->clientid); }
                $this->ok(json_encode(['id' => $id]));
                break;
            case 'list-document':
                $parent = null;
                if (!empty($body['path'])) {
                    $parent = $this->ked->pathToDn($body['path']);
                    if ($parent === null) { $this->errorNotFound(); }
                }
                $extended = false;
                if (!empty($body['format']) && strtolower($body['format']) === 'extended') {
                    $extended = true;
                }
                $documents = $this->ked->listDirectory($parent, $extended);
                if ($documents === null) { $this->errorUnableToOperate(); }
                $this->ok(json_encode(['documents' => $documents]));
                break;
            case 'get-info':
                if (empty($body['path'])) { $this->errorBadRequest(); }
                $document = $this->ked->getInfo($body['path']);
                if ($document === null) { $this->errorNotFound(); }
                $this->ok(json_encode($document));
                break;
            case 'get-document':
                if (empty($body['path'])) { $this->errorBadRequest(); }
                $docDn = $this->ked->pathToDn($body['path']);
                if ($docDn === null) { $this->errorNotFound(); }
                if (!$this->acl->can($this->user, 'access', $docDn)) { $this->errorForbidden(); }
                $document = $this->ked->getDocument($docDn, true);
                $this->ok(json_encode($document));
                break;
            case 'get-entry':
                if (empty($body['path'])) { $this->errorBadRequest(); }
                $entryDn = $this->ked->pathToDn($body['path'], false);
                if ($entryDn === null) { $this->errorNotFound(); }
                if (!$this->acl->can($this->user, 'access', $entryDn)) { $this->errorForbidden(); }
                $entry = $this->ked->getEntry($entryDn);
                $this->ok(json_encode(['entry' => $entry]));
                break;
            case 'add-entry':
            case 'update-entry':
                $update = false;
                if ($body['operation'] === 'update-entry') { $update = true; }

                if (empty($body['path'])) { $this->errorBadRequest(); }
                if (empty($body['_file']) || !is_array($body['_file'])) { $this->errorBadRequest(); }

                $mimeparts = explode('/', $body['_file']['type']);
                $id = null;
                $application = [];
                if (!empty($body['_file']['name'])) {
                    $application[] = 'ked:name=' . $body['_file']['name'];
                }
                if (!empty($body['_file']['size'])) {
                    $application[] = 'ked:size=' . $body['_file']['size'];
                }
                $id;
                switch($mimeparts[0]) {
                    case 'text':
                        $content = file_get_contents($body['_file']['tmp_name']);
                        if ($content === false) { $this->errorBadRequest(); }
                        if ($update) {
                            $id = $this->ked->updateTextEntry($body['path'], $content, $body['_file']['type'], $application);
                        } else {
                            $id = $this->ked->addTextEntry($body['path'], $content, $body['_file']['type'], $application);
                        }
                        break;
                    case 'image':
                        if ($this->config('disable-file-upload')) { $this->errorForbidden(); }
                        /* unsupported format are as blob */
                        if (!$this->ked->isSupportedImage($body['_file']['tmp_name'])) {
                            if ($update) {
                                $id = $this->ked->updateBinaryEntry($body['path'], $body['_file']['tmp_name'], $body['_file']['type'], $application);
                            } else {
                                $id = $this->ked->addBinaryEntry($body['path'], $body['_file']['tmp_name'], $body['_file']['type'], $application);
                            }
                            break;
                        }
                        if ($update) {
                            $id = $this->ked->updateImageEntry($body['path'], $body['_file']['tmp_name'], $application);
                        } else {
                            $id = $this->ked->addImageEntry($body['path'], $body['_file']['tmp_name'], $application);
                        }
                        break;
                    default:
                        if ($this->config('disable-file-upload')) { $this->errorForbidden(); }
                        if ($update) {
                            $id = $this->ked->updateBinaryEntry($body['path'], $body['_file']['tmp_name'], $body['_file']['type'], $application);
                        } else {
                            $id = $this->ked->addBinaryEntry($body['path'], $body['_file']['tmp_name'], $body['_file']['type'], $application);
                        }
                        break;
                }
                if ($id === null) { $this->errorUnableToOperate(); }
                if ($this->msg) { 
                    $path = explode(',', $id);
                    $this->msg->update($path[count($path) - 2], $this->clientid); 
                }
                $this->ok(json_encode(['id' => $id]));
                break;
            case 'to-not-task':
                if ($this->config('disable-task')) { $this->errorForbidden(); }
                if (empty($body['path'])) { $this->errorBadRequest(); }
                if (!$this->ked->anyToNotTask($body['path'])) { $this->errorUnableToOperate(); }
                if ($this->msg) { $this->msg->create($body['path'], $this->clientid); }
                return $this->ok(json_encode(['path' => $body['path'], 'modified' => true]));
                break;
            case 'update-task':
                // fall through
            case 'to-task':
                if ($this->config('disable-task')) { $this->errorForbidden(); }
                if (empty($body['path'])) { $this->errorBadRequest(); }
                $params = [];
                foreach ([ 'taskPrevious', 'taskEnd', 'taskDone' ] as $key) {
                    if (!empty($body[$key])) {
                        if (!is_string($body[$key])) { $this->errorBadRequest(); }
                        $params[$key] = $body[$key];
                    } else {
                        if (isset($body[$key])) { $params[$key] = ''; }
                    }
                }
                $modified = false;
                if ($body['operation'] === 'update-task') {
                    $modified = $this->ked->updateTask($body['path'], $params);
                } else {
                    $modified = $this->ked->anyToTask($body['path'], $params);
                }
                if (!$modified) { $this->errorUnableToOperate(); }
                if ($this->msg) { $this->msg->create($body['path'], $this->clientid); }
                $this->ok(json_encode(['path' => $body['path'], 'modified' => $modified]));
                break;
            case 'delete':
                if (empty($body['path'])) { $this->errorBadRequest(); }
                $anyDn = $this->ked->pathToDn($body['path'], false);
                if ($anyDn === NULL) { $this->errorNotFound(); }
                $deleted = $this->ked->deleteByDn($anyDn);
                if ($this->msg) { $this->msg->delete($this->ked->idFromPath($body['path']), $this->clientid); }
                $this->ok(json_encode(['path' => $body['path'], 'deleted' => $deleted]));
                break;
            case 'lock':
                if ($this->clientid === null) { $this->errorBadRequest(); }
                if (empty($body['anyid'])) { $this->errorBadRequest(); }
                $dn = $this->ked->pathToDn($body['anyid']);
                if (!$dn) { $this->errorNotFound(); }
                $currentlock = null;
                $lock = $this->states->lock($this->clientid, $dn, $currentlock);
                if ($lock) { if ($this->msg) { $this->msg->lock($this->ked->idFromPath($body['anyid']), $this->clientid); } }
                $this->ok(json_encode(['lock' => $lock ? true : false, 'current' => $currentlock]));
                break;
            case 'unlock':
                if ($this->clientid === null) { $this->errorBadRequest(); }
                if (empty($body['anyid'])) { $this->errorBadRequest(); }
                $dn = $this->ked->pathToDn($body['anyid']);
                if (!$dn) { $this->errorNotFound(); }
                $this->states->unlock($this->clientid, $dn);
                if ($this->msg) { $this->msg->unlock($this->ked->idFromPath($body['anyid']), $this->clientid); }
                $this->ok(json_encode(['lock' => false]));
                break;
            case 'connected':
                $users = $this->states->getconnected();
                $display = [];
                foreach ($users as $user) {
                    $userObject = $this->userStore->getUserByDbId($user['dn']);
                    $name = $userObject->getDisplayName();
                    $display[] = [
                        'name' => $name,
                        'timestamp' => $user['timestamp']
                    ];
                }
                $this->ok(json_encode(['users' => $display]));
                break;
            case 'get-active-tags':
                $this->ok(json_encode(['tags' => $this->ked->findActiveTags()]));
                break;
        }
    }
}

?>