/* web worker to upload file */

/* slice the file into 1mb part, store each part in indexeddb while uploading
 * them until the last one. A hash is generated and sent to server in order
 * to compare after reassemble. metadata are sent with each chunk because why
 * not. A token must be requested before upload, this act as authentication.
 */

const UPLOAD_KEYS = []
let FAILED_FETCH = 0

function openCache () {
    return new Promise ((resolve, reject) => {

        if (openCache.idb) {
            resolve(openCache.idb)
            return
        }

        const IDB = indexedDB.open('KEDStore', 1)
        IDB.onupgradeneeded = function (event) {
            const idb = event.target.result
            const upcache = idb.createObjectStore('UploadCache', {keyPath: 'id'})
            upcache.createIndex('idxToken', 'token', {unique: false})
            const tokens = idb.createObjectStore('Tokens', {keyPath: 'token'})
            upcache.transaction.oncomplete = function (event) {
                openCache.opened = event.target.result
                resolve(openCache.opened)
            }
            upcache.transaction.onerror = function (event) {
                openCache.opened = false
                reject(event)
            }
            upcache.transaction.oncomplete = function (event) {
                openCache.opened = event.target.result
                resolve(openCache.opened)
            }
        }

        IDB.onsuccess = function (event) {
            openCache.opened = event.target.result
            resolve(openCache.opened)
        }

        IDB.onerror = function (event) {
            openCache.opened = false
            reject(event)
        }
    })
}

function cacheChunk (chunk) {
    return new Promise((resolve, reject) => {
        if (!chunk.id) { reject(); return }
        openCache()
        .then(idb => {
            const tr = idb.transaction(['UploadCache', 'Tokens'], 'readwrite')
            const addReq = tr.objectStore('UploadCache')
                .add(chunk)

            tr.onerror = function (event) {
                event.target.abort()
            }
            tr.oncomplete = function (event) {
                console.log(event)
                resolve()
            }

            addReq.onsuccess = function (event) {
                const hasKey = event.target.transaction.objectStore('Tokens')
                    .getKey(chunk.token)
                hasKey.onsuccess = function (event) {
                    const key = event.target.result
                    if (!key) {
                        event.target.transaction.objectStore('Tokens')
                            .add({token: chunk.token, done: false, start: new Date()})
                    }
                }
                hasKey.onerror = function (event) {
                    event.target.transaction.abort()
                }
            }

            addReq.onerror = function (event) {
                event.target.transaction.abort()
            }

        })
    })
}

function uncacheChunk (chunk) {
    return new Promise((resolve, reject) => {
        openCache()
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
                            console.log(event)
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
                            }
                        }
                        tokRequest.onerror = function (event) {
                            event.target.transaction.abort()
                        }
                    } else {
                        tr.commit()
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
            tr.oncomplete = function (event) {
                resolve()
            }
        })
    })
}
 
const KChunkSize = 1048576 // 1meg, max nginx post body size
self.onmessage = function (msg) {
    const file = msg.data.file
    file.arrayBuffer()
    .then(buffer => {
        return new Promise((resolve, reject) => {
            crypto.subtle.digest('sha-256', buffer)
            .then(hash => {
                resolve([hash, buffer])
            })
        })
    })
    .then(([hash, buffer]) => {
        let partCount = 0;
        const hashStr = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
        for (let i = 0; i < buffer.byteLength; i += KChunkSize) {
            const chunk = {
                hash: hashStr,
                count: partCount,
                max: Math.ceil(file.size / KChunkSize),
                size: KChunkSize,
                filename: file.name,
                filesize: file.size,
                filetype: file.type,
                token: msg.data.token,
                part: buffer.slice(i, i + KChunkSize),
                id: `${msg.data.token}-${partCount.toString().padStart(6, '0')}`
            }
            ++partCount
            cacheChunk(chunk)
        }
    })
}
  
function sendChunk (idb, chunkKey) {
    return new Promise((resolve, reject) => {
        const tr = idb.transaction('UploadCache', 'readonly')
        .objectStore('UploadCache')
        .get(chunkKey)
        tr.onsuccess = function (event) {
            const chunk = event.target.result
            if (!event.target.result) {
                reject()
                return;
            }
            const headers = new Headers()
            headers.append('x-ked-chunk-count', chunk.count)
            headers.append('x-ked-chunk-max', chunk.max)
            headers.append('x-ked-chunk-size', chunk.size)
            headers.append('x-ked-filename', chunk.filename)
            headers.append('x-ked-filesize', chunk.filesize)
            headers.append('x-ked-filetype', chunk.filetype)
            headers.append('x-ked-token', chunk.token)
            headers.append('x-ked-hash', chunk.hash)
          //  const blob = new Blob([chunk.part], {type: chunk.type})
            fetch('../../../web/upload.php', {method: 'POST', body: chunk.part, headers: headers})
            .then (response => {
                if (!response.ok) { reject(); return }
                FAILED_FETCH = 0
                return response.json()
            })
            .then(result => {
                if (result.id === chunkKey) {
                    resolve([chunk, result])
                    return
                }
                reject()
            })
            .catch(e => {
                FAILED_FETCH++
                console.log(e)
                reject()
            })
        }
    })
}

function processQueue (idb) {
    const key = UPLOAD_KEYS.shift()
    if (!key) { setTimeout(() => { processQueue(idb) }, 2); return }
    sendChunk(idb, key)
    .then(([chunk, result]) => {
        console.log('uncache')
        if (result.done) {
            self.postMessage({token: result.token, done: true})
        }
        return uncacheChunk(chunk)
    })
    .then(_ => {
        processQueue(idb)
    })
    .catch(_ => {
        processQueue(idb)
    })
}

function iterateChunks (idb) {
    if (FAILED_FETCH > 10) {
        FAILED_FETCH = 0
        setTimeout(() => { iterateChunks(idb) }, 5000)
    }
    const tr = idb.transaction('UploadCache', 'readonly')
    .objectStore('UploadCache')
    .openKeyCursor()
    tr.onsuccess = function (event) {
        const cursor = event.target.result
        if (cursor) {
            if (UPLOAD_KEYS.indexOf(cursor.key) === -1) {
                UPLOAD_KEYS.push(cursor.key)
            }
            cursor.continue()
        } else {
            setTimeout(() => { iterateChunks(idb) }, 2000)
        }
    }
}

openCache()
.then(idb => {
   iterateChunks(idb)
   processQueue(idb)
})