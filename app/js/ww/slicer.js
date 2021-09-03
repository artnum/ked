/* web worker to upload file */

/* slice the file into 1mb part, store each part in indexeddb while uploading
 * them until the last one. A hash is generated and sent to server in order
 * to compare after reassemble. metadata are sent with each chunk because why
 * not. A token must be requested before upload, this act as authentication.
 */

importScripts('../lib/cache.js')
const Kache = new KEDCache()

const Uploader = new Worker('uploader.js')

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
                path: msg.data.path,
                part: buffer.slice(i, i + KChunkSize),
                id: `${msg.data.token}-${partCount.toString().padStart(6, '0')}`
            }
            ++partCount
            Kache.add(chunk)
            .then(_ => {
                Uploader.postMessage({operation: 'addChunk', key: chunk.id})
            })
        }
    })
}

Uploader.onmessage = function (msg) {
    const content = msg.data
    switch (content.operation) {
        case 'state':
            Kache.hasChunk(content.token)
            .then(num => {
                if (num === 0) {
                    Kache.rmToken(content.token)
                    .then(tk => {
                        if (tk === null) { return }
                        self.postMessage({operation: 'uploadDone', content: tk})
                    })
                }
            })
            break
    }
}