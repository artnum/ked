function KEDCache () {
    this.IDB = false
}

KEDCache.prototype.open = function () {
    return new Promise ((resolve, reject) => {

        if (this.IDB) {
            resolve(this.IDB)
            return
        }

        const IDB = indexedDB.open('KEDStore', 1)
        IDB.onupgradeneeded = (event)  => {
            const idb = event.target.result
            const upcache = idb.createObjectStore('UploadCache', {keyPath: 'id'})
            upcache.createIndex('idxToken', 'token', {unique: false})
            const tokens = idb.createObjectStore('Tokens', {keyPath: 'token'})
            upcache.transaction.oncomplete = (event) => {
                this.IDB = event.target.result
                resolve(this.IDB)
            }
            upcache.transaction.onerror = (event) => {
                this.IDB = false
                reject(event)
            }
            upcache.transaction.oncomplete = (event) => {
                this.IDB = event.target.result
                resolve(this.IDB)
            }
        }

        IDB.onsuccess = (event) => {
            this.IDB = event.target.result
            resolve(this.IDB)
        }

        IDB.onerror = (event) => {
            this.IDB = false
            reject(event)
        }
    })
}

KEDCache.prototype.add = function (chunk) {
    return new Promise((resolve, reject) => {
        if (!chunk.id) { reject(); return }
        this.open()
        .then(idb => {
            chunk.failCount = 0
            const tr = idb.transaction(['UploadCache', 'Tokens'], 'readwrite')
            const addReq = tr.objectStore('UploadCache')
                .add(chunk)

            tr.onerror = function (event) {
                event.target.abort()
            }
            tr.oncomplete = function (event) {
            }

            addReq.onsuccess = function (event) {
                const hasKey = event.target.transaction.objectStore('Tokens')
                    .getKey(chunk.token)
                hasKey.onsuccess = function (event) {
                    const key = event.target.result
                    if (!key) {
                        event.target.transaction.objectStore('Tokens')
                            .add({token: chunk.token, done: false, start: new Date(), path: chunk.path})
                    }
                    tr.commit()
                    resolve()
                }
                hasKey.onerror = function (event) {
                    event.target.transaction.abort()
                }
            }

            addReq.onerror = function (event) {
                event.target.transaction.abort()
                reject()
            }

        })
    })
}

KEDCache.prototype.remove = function (chunk) {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            console.log('uncache run')
            const tr = idb.transaction(['UploadCache', 'Tokens'], 'readwrite')
                            
            const upcache = tr.objectStore('UploadCache')
                .delete(chunk.id)
            upcache.onsuccess = function (event) {
                const idxRequest = tr.objectStore('UploadCache')
                    .index('idxToken')
                    .count(chunk.id)
                idxRequest.onsuccess = function (event) {
                    if (event.target.result === 0) {
                        const tokRequest = tr.objectStore('Tokens')
                            .get(chunk.token)
                        tokRequest.onsuccess = function (event) {
                            const tok = event.target.result
                            if (!tok) {
                                event.target.transaction.abort()
                                return
                            }
                            tok.done = true
                            const tokRequest = tr.objectStore('Tokens')
                                .put(tok)
                            tokRequest.onsuccess = function(event) {
                                event.target.transaction.commit()
                                resolve(tok)
                            }
                        }
                        tokRequest.onerror = function (event) {
                            event.target.transaction.abort()
                        }
                    } else {
                        tr.commit()
                        resolve({done: false})
                    }
                }
                idxRequest.onerror = function (event) {
                    event.target.transaction.abort()
                }
            }
            tr.onerror = function (event) {
                console.log('Transaction error, abort')
                event.target.abort()
                reject(event)
            }
        })
    })
}

KEDCache.prototype.rmToken = function (token) {
    return new Promise((resolve, reject) => {
        this.open()
        .then(idb => {
            const tr = idb.transaction(['Tokens'], 'readwrite')
            const tok = tr.objectStore('Tokens')
                .get(token)

            tok.onsuccess = function (event) {
                const tr = event.target.transaction
                const result = event.target.result
                console.log(event)
                resolve(result)
                tr.objectStore('Tokens')
                .delete(token)
            }
        })
    })
}

KEDCache.prototype.incFail = function (key) {
    return new Promise((resolve, reject) => {
        const tr = this.IDB.transaction(['UploadCache'], 'readwrite')
        const req = tr.objectStore('UploadCache')
            .get(key)
        req.onsuccess = function (event) {
            const chunk = event.target.result
            
            if (chunk.failCount === undefined) {
                chunk.failCount = 1
            } else {
                chunk.failCount++
            }

            const req = event.target.transaction.objectStore('UploadCache')
                .put(chunk)

            req.onsuccess = this.trSuccess
            req.onerror = this.trFail
        }
        req.onerror = this.trFail
    })
}

KEDCache.prototype.trFail = function (event) {
    event.target.transaction.abort()
    if (reject) { reject(new Error('Transaction failed')) }
}

KEDCache.prototype.trSuccess = function (event) {
    event.target.transaction.commit()
    if (resolve) { resolve(event.target.result) }
}