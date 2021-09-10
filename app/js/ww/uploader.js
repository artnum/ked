/* web worker to upload file */

/* slice the file into 1mb part, store each part in indexeddb while uploading
 * them until the last one. A hash is generated and sent to server in order
 * to compare after reassemble. metadata are sent with each chunk because why
 * not. A token must be requested before upload, this act as authentication.
 */

importScripts('../lib/cache.js')
const Kache = new KEDCache()

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
            headers.append('x-ked-path', chunk.path)
            fetch('../../../web/upload.php', {method: 'POST', body: chunk.part, headers: headers})
            .then (response => {
                if (!response.ok) { reject(); return }
                return response.json()
            })
            .then(result => {
                if (result.id === chunkKey) {
                    resolve([chunk, result])
                    return
                }
                if (chunk.failCount > 10) {
                    Kache.remove(chunk)
                } else {
                    Kache.incFail(chunk.id)
                }
                reject()
            })
            .catch(e => {
                if (e instanceof TypeError) {
                    reject(new Error('NetError'))
                }
                reject()
            })
        }
    })
}

function iterateChunks (idb) {
    return new Promise((resolve, reject) => {
        const UPLOAD_KEYS = []
        const tr = idb.transaction('UploadCache', 'readonly')
        .objectStore('UploadCache')
        .openKeyCursor()
        tr.onsuccess = function (event) {
            const cursor = event.target.result
            if (cursor) {
                const key = cursor.key
                if (UPLOAD_KEYS.length > 10) { resolve([idb, UPLOAD_KEYS]); return; }
                if (UPLOAD_KEYS.indexOf(key) !== -1) { cursor.continue(); return; }
                UPLOAD_KEYS.push(key)
                if (UPLOAD_KEYS.length < 10) {
                    cursor.continue()
                } else {
                    resolve([idb, UPLOAD_KEYS])
                    return
                }
            } else {
                resolve([idb, UPLOAD_KEYS])
                return
            }
        }
    })
}

function uploadChunks (idb, UPLOAD_KEYS) {
    return new Promise((resolve, reject) => {
        const uploads = []
        while(key = UPLOAD_KEYS.pop()) {
            uploads.push(
                sendChunk(idb, key)
                .then (([chunk, result]) => {       
                    if (!result.id) {
                        return false
                    } else {
                        return Kache.remove(chunk)
                    }
                })
                .then(token => {
                    if (!token) { return false }
                    return Kache.hasChunk(token) 
                    .then (num => {
                        self.postMessage({operation: 'state', token: token, left: num, net: true})
                        return true
                    })
                })
                .catch(e => {
                    return false
                })
            )
        }
        Promise.allSettled(uploads)
        .then(results => {
            /* if at least one succeed, we have net connection, else we don't */
            let success = false
            results.forEach(result => {
                if (result.value) { success = true}
            })
            if(!success && results.length > 0) { self.postMessage({operation: 'state', token: null, left: 0, net: false}) }
            resolve(success)
        })
    })
}

let running = false
/* on start, empty */
function run () {
    if (running) { setTimeout(run, 2000); return; }
    running = true
    Kache.open()
    .then(idb => {
        return iterateChunks(idb)
    })
    .then(([idb, keys]) => {
        return uploadChunks(idb, keys)
    })
    .then(success => {
        if (!success) { return true; }
        return Kache.isEmpty()
    })
    .then(empty => {
        running = false
        if (empty) { setTimeout(run, 2000) }
        else { run() }
    })
    .catch(_ => {
        running = false
        setTimeout(run, 2000)
    })
}

run()