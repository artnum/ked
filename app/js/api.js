function KEDApi (uri) {
    this.uri = uri instanceof URL ? uri : new URL(uri)
    this.EvtTarget = new EventTarget()
    this.KeyStore = new MenshenKeyStore()
    this.Menshen = new Menshen({version: 2})
}

KEDApi.prototype.getClientId = function () {
    return new Promise((resolve, reject) => {
        this.clientid = localStorage.getItem('ked-client-id')
        if (!this.clientid) {
            crypto.subtle.digest(
                {name: 'SHA-256'},
                new TextEncoder().encode(`${navigator.userAgent}-${navigator.platform}-${navigator.vendor}-${new Date().toISOString()}`)
            ).then(hash => {
                this.clientid = KEDUtils.base64EncodeArrayBuffer(hash)
                localStorage.setItem('ked-client-id', this.clientid)
                resolve(this.clientid)
            })
            .catch(reason => {
                reason instanceof Error ? reject(reason) : reject(new Error(reason))
            })
        } else {
            resolve(this.clientid)
        }
    })
}

KEDApi.prototype.addEventListener = function(signal, callback, options) {
    this.EvtTarget.addEventListener(signal, callback, options)
}

KEDApi.prototype.removeEventListener = function(signal, callback, options) {
    this.EvtTarget.removeEventListener(signal, callabck, options)
}

KEDApi.prototype.hasKey = function (username) {
    return new Promise((resolve, reject) => {
        this.KeyStore.hasAuth(username)
        .then(resolve)
        .catch(reason => {
            console.log(reason)
        })
    })
}

KEDApi.prototype.getPass = function () {
    return new Promise((resolve, reject) => {
        this.KeyStore.exportPKeyPin()
        .then(key => {
            resolve(key)
        })
    })
}

KEDApi.prototype.logout = function () {
    this.Menshen.clear()
    this.KeyStore.clear()
}

KEDApi.prototype.init = function (username, password) {
    return new Promise((resolve, reject) => {
        this.KeyStore.importPKeyPin(username, password)
        .then(() => {
            return this.KeyStore.getAuth(username)
        }).then(key => {
            if (!key) {
                resolve(false)
            } else {
                let pkey
                if (key.pkey instanceof CryptoKey) {
                    pkey = this.Menshen.setPrivateKey(key.pkey)
                } else {
                    pkey = this.Menshen.setPkcs8PrivateKey(key.pkey)
                }
                pkey.then(() => {
                    this.Menshen.setClientId(key.cid)
                    resolve(true)
                })
                .catch(reason => {
                    console.log(reason)
                    resolve(false)
                })
            }
        })
        .catch(reason => {
            resolve(false)
        })
    })
}

KEDApi.prototype.setPassword = function(password) {
    return this.KeyStore.setPKeyPin(password)
}

KEDApi.prototype.importAuth = function(username, pemkey) {
    return this.KeyStore.importPrivateKey(pemkey, username, '', 'SHA-256')
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
        this.getRandomId()
        .then(rid => {
            opts.headers.set('X-Request-Id', rid)
            return opts
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

KEDApi.prototype.getRandomId = function () {
    if (!this.getRandomId.count) {
        this.getRandomId.count = 0
    }
    this.getRandomId.count++
    return new Promise((resolve, reject) => {
        this.getClientId()
        .then(clientid => {
            const rand = crypto.getRandomValues(new Uint8Array(6)) // 8 b64 chars
            resolve(`${clientid}${this.getRandomId.count}${MenshenEncoding.buf2b64(rand)}`) 
        })
        .catch(reason => {
            reject(reason)
        })
    })
}

KEDApi.prototype.getUrl = function (url) {
    return new Promise((resolve, reject) => {
        this.getRandomId()
        .then(rid => {
            const resultURL = url instanceof URL ? url : new URL(url)
            return this.Menshen.qstring(resultURL, 'GET', rid)
        })
        .then(url => {
            resolve(url)
        })
        .catch(reason => reject(reason))
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
                this.EvtTarget.dispatchEvent(new ErrorEvent('error', {message: ret.data}))
                resolve(ret)
                return null
            }
            if (!response.headers.get('Content-Type').startsWith('application/json')) {
                resolve({ok: false, netError: false, data: 'Mauvais format de données'})
                this.EvtTarget.dispatchEvent(new ErrorEvent('error', {message: 'Mauvais format de données'}))
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
            this.EvtTarget.dispatchEvent(new ErrorEvent('error', {message: reason instanceof Error ? reason.message : resaon}))
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

KEDApi.prototype.getUser = function () {
    const operation = {
        operation: 'get-user'
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

KEDApi.prototype.listDocument = function (path) {
    const operation = {
        operation: 'list-document',
        path
    }
    return new Promise((resolve) => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.searchByTags = function (tags) {
    const operation = {
        operation: 'search-by-tags',
        tags
    }
    return new Promise((resolve) => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.delete = function (path) {
    const operation = {
        operation: 'delete',
        path
    }
    return new Promise((resolve) => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.getUsers = function () {
    return new Promise((resolve) => {
        this.post({operation: 'connected'})
        .then(result => {
            resolve(result)
        })
    })
}