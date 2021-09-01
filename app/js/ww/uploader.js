/* web worker to upload file */

/* slice the file into 1mb part, store each part in indexeddb while uploading
 * them until the last one. A hash is generated and sent to server in order
 * to compare after reassemble. metadata are sent with each chunk because why
 * not. A token must be requested before upload, this act as authentication.
 */

const UPLOAD_KEYS = []
importScripts('lib/cache.js')
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
                console.log(e)
                reject()
            })
        }
    })
}

function iterateChunks (idb) {
    const tr = idb.transaction('UploadCache', 'readonly')
    .objectStore('UploadCache')
    .openKeyCursor()
    tr.onsuccess = function (event) {
        const cursor = event.target.result
        if (cursor) {
            sendChunk(idb, cursor.key)
            .then (([chunk, result]) => {
                return Kache.remove(chunk)
            })
            .then(token => {
                self.postMessage(token)
            })
            .catch(e => {
            })
            cursor.continue()
        } else {
        }
    }
}

self.onmessage = function (msg) {
    Kache.open()
    .then(idb => {
        console.log(msg.data)
        sendChunk(idb, msg.data.key)
        .then (([chunk, result]) => {
            console.log(result)
            return Kache.remove(chunk)
        })
        .then(token => {
            self.postMessage(token)
        })
        .catch(e => {
        })
    })
}

/* on start, empty */
Kache.open()
.then(idb => {
    iterateChunks(idb)
})