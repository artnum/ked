function KEDApi (uri) {
    this.uri = uri instanceof URL ? uri : new URL(uri)
    this.EvtTarget = new EventTarget()
    this.KeyStore = new MenshenKeyStore()
    this.Menshen = new Menshen({version: 2})
    this.Uploader = new Worker('../js/ww/slicer.js')
    this.Uploader.onmessage = this.handleUploaderMessage.bind(this)
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

KEDApi.prototype.fetch = function(url, opts = {}, offlineStore = false) {
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
        this.getClientId()
        .then(clientId => {
            opts.headers.set('X-Client-Id', clientId)
            return this.getRandomId()
        })
        .then(rid => {
            opts.headers.set('X-Request-Id', rid)
            return opts
        })
        .then(opts => {
            this.Menshen.fetch(url, opts)
            .then(response => {
                resolve(response)
            })
            .catch(reason => { reject(reason) })
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

KEDApi.prototype.sanitize = function (json) {
    for (const k in json) {
        if (typeof json[k] === 'object' || Array.isArray(json[k])) {
            json[k] = this.sanitize(json[k])
        } else if (typeof json[k] === 'string') {
            json[k] = KEDUtils.sanitize(json[k])
        }
    }
    return json
}

KEDApi.prototype.post = function(body, offlineStore = false) {
    return new Promise((resolve) => {
        this.fetch(this.uri, {
            method: 'POST',
            body: body instanceof FormData ? body : JSON.stringify(body)
        }, offlineStore)
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
                    case 403: ret.data = 'Accès non-autorisé'; break
                    case 400: ret.data = 'Mauvaise requête'; break
                    case 406: ret.data = 'Mauvais contenu'; break;
                    case 405: ret.data = 'Méthode non-supportée'; break
                    case 500: ret.data = 'Serveur en difficulté'; break
                }
                /* object not found can be normal, don't trigger an error display here */
                if (response.status !== 404) {
                    this.EvtTarget.dispatchEvent(new ErrorEvent('error', {message: ret.data}))
                }
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
            result = this.sanitize(result)
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

KEDApi.prototype.updateDocument = function (path, title) {
    const operation = {
        operation: 'update-document',
        path,
        name: title
    }
    return new Promise((resolve, reject) => {
        this.post(operation)
        .then(result => {
            if (!result.ok) { reject('Modification failed'); return }
            return resolve(result.data)
        })
    })

}

KEDApi.prototype.getDocument = function (path) {
    const operation = {
        operation: 'get-document',
        path
    }
    return new Promise((resolve, reject) => {
        this.post(operation)
        .then(result => {
            if (!result.ok) { reject('Document unavailable'); return }
            resolve(result.data)
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

KEDApi.prototype.getInvit = function (user, invit) {
    const operation = {
        operation: 'get-invit',
        user,
        invit
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

KEDApi.prototype.getEntry = function (path) {
    const operation = {
        operation: 'get-entry',
        path
    }
    return new Promise(resolve => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.lock = function (idOrDoc) {
    const operation = {
        operation: 'lock',
        anyid: idOrDoc instanceof KEDDocument ? idOrDoc.getId() : idOrDoc    
    }
    return new Promise(resolve => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.unlock = function (idOrDoc) {
    const operation = {
        operation: 'unlock',
        anyid: idOrDoc instanceof KEDDocument ? idOrDoc.getId() : idOrDoc    
    }
    return new Promise(resolve => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.activeTags = function () {
    return new Promise(resolve => {
        this.post({operation: 'get-active-tags'})
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.removeTag = function (path, tag) {
    const operation = {
        operation: 'remove-tag',
        path,
        tag
    }
    return new Promise(resolve => {
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.archive = function (idOrDoc) {
    return new Promise(resolve => {
        this.post({
            operation: 'archive',
            anyid: idOrDoc instanceof KEDDocument ? idOrDoc.getId() : idOrDoc
        })
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.unarchive = function (idOrDoc) {
    return new Promise(resolve => {
        this.post({
            operation: 'unarchive',
            anyid: idOrDoc instanceof KEDDocument ? idOrDoc.getId() : idOrDoc
        })
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.createTag = function (name, related = []) {
    return new Promise((resolve, reject) => {
        if (name === null) { resolve(null); return; }
        const operation = {
            operation: 'create-tag',
            name,
            related
        }
        this.post(operation)
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.getInfo = function (path) {
    return new Promise((resolve, reject) => {
        const operation = {
            operation: 'get-info',
            path
        }
        this.post(operation)
        .then(result => {
            if (!result.ok) { resolve(null); return; }
            resolve(result.data)
        })
    })
}

KEDApi.prototype.check = function (path, access) {
    return new Promise((resolve, reject) => {
        this.post({
            operation: 'check',
            path,
            access
        })
        .then(result => {
            if (!result.ok) { resolve(false); return; }
            resolve(result.data.can)
        })
    })
}

KEDApi.prototype.createDocument = function (name, path, tags = []) {
    return new Promise((resolve, reject) => {
        this.post({
            operation: 'create-document',
            path,
            name,
            tags
        })
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.setEntryDescription = function (path, description) {
    return new Promise((resolve, reject) => {
        this.post({
            operation: 'set-entry-description',
            path,
            description
        })
        .then(result => {
            resolve(result)
        })
    })
}

KEDApi.prototype.upload = function (path, file) {
    return new Promise((resolve, reject) => {
        this.post({
            operation: 'chunk-upload',
            filename: file.name,
            path
        })
        .then(response => {
            if (!response.ok) { reject(response); return }
            return response.data.token
        })
        .then(token => {
            if (!token) { reject(); return }
            this.Uploader.postMessage({file, token, path})
            resolve(token)
        })
    })
}

KEDApi.prototype.cancelUpload = function () {
    this.Uploader.postMessage({operation: 'cancel'})
}

KEDApi.prototype.handleUploaderMessage = function (msg) {
    const content = msg.data
    switch(content.operation) {
        case 'uploadDone':
            this.EvtTarget.dispatchEvent(new CustomEvent('uploaded', {detail: content}))
            break
        case 'state':
            this.EvtTarget.dispatchEvent(new CustomEvent('upload-state', {
                detail: {
                    files: content.files,
                    state: content.state
                }
            }))
    }
}