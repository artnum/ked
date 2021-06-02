function KEDApi (uri) {
    this.uri = uri instanceof URL ? uri : new URL(uri)
    this.EvtTarget = new EventTarget()
    this.KeyStore = new MenshenKeyStore()
    this.Menshen = new Menshen({version: 2})
}

KEDApi.prototype.addEventListener = function(signal, callback, options) {
    this.EvtTarget.addEventListener(signal, callaback, options)
}

KEDApi.prototype.removeEventListener = function(signal, callback, options) {
    this.EvtTarget.removeEventListener(signal, callabck, options)
}

KEDApi.prototype.init = function () {
    return new Promise((resolve, reject) => {
        this.KeyStore.getAuth()
        .then(key => {
            if (!key) {
                resolve(false)
            } else {
                this.Menshen.setPrivateKey(key.pkey)
                this.Menshen.setClientId(key.cid)
                resolve(true)
            }
        })
        .catch(reason => {
            reject(reason)
        })
    })
}

KEDApi.prototype.importAuth = function(username, pemkey) {
    this.KeyStore.importPrivateKey(pemkey, username, '', 'SHA-256')
}

KEDApi.prototype.fetch = function(url, opts = {}) {
    return new Promise((resolve, reject) => {
        if (opts.headers === undefined) {
            opts.headers = new Headers()
        }
        if (!(opts.headers instanceof Headers)) {
            const headers = new Headers()
            for (const k in opt.headers) {
                headers.append(k, opts.headers[k])
            }
            opts.headers[k]
        }
        new Promise((resolve, reject) => {
            const id = 
                (new Date().getTime()).toString() +
                (performance.now()).toString() +
                (navigator.userAgent).toString()
            crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(id)
            )
            .then(hash => {
                opts.headers.set('X-Request-Id', MenshenEncoding.buf2b64(hash))
                resolve(opts)
            })
            .catch(reason => reject(reason))
        })
        .then(opts => {
            return this.Menshen.fetch(url, opts)
        })
        .then(response => {
            resolve(response)
        })
        .catch(reason => { reject(reason) })
    })
}

KEDApi.prototype.post = function(body) {
    return new Promise((resolve) => {
        this.fetch(this.uri, {
            method: 'POST',
            body: body instanceof FormData ? body : JSON.stringify(body)
        })
        .then(response => {
            if (!response.ok) {
                const ret = { 
                    ok: false,
                    netError: false,
                    data: 'Error'
                }
                switch (response.status) {
                    default: break;
                    case 404: ret.data = 'Objet pas trouvé'; break
                    case 400: ret.data = 'Mauvaise requête'; break
                    case 406: ret.data = 'Mauvais contenu'; break;
                    case 405: ret.data = 'Méthode non-supportée'; break
                    case 500: ret.data = 'Serveur en difficulté'; break
                }
                resolve(ret)
                return null
            }
            return response.json()
        })
        .then(result => {
            if (!result) { return }
            resolve({
                ok: true,
                netError: false,
                data: result})
        })
        .catch(reason => {
            console.log(reason)
            resolve({
                ok: false,
                netError: true,
                data: reason
            })
        })
    })
}

KEDApi.prototype.getDocument = function (path) {
    const operation = {
        operation: 'get-document',
        path
    }
    return new Promise((resolve) => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.listTags = function(maxsize = 100) {
    const operation = {
        operation: 'list-tags',
        maxsize
    }
    return new Promise((resolve) => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.searchTags = function(expression, maxsize = 5) {
    const operation = {
        operation: 'search-tags',
        expression,
        maxsize
    }
    return new Promise((resolve) => {
        if (operation.expression.length <= 0) {
            this.listTags()
            .then(result => {
                resolve(result)
            })
            return
        }

        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}
