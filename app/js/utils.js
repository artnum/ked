const KEDUtils = {
    base64EncodeString: (value) => {
        return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '.')
    },

    base64EncodeArrayBuffer: (buffer) => {
        let binary = ''
        const bytes = new Uint8Array( buffer )
        for (const byte of bytes) {
            binary += String.fromCharCode(byte)
        }
        return KEDUtils.base64EncodeString( binary )
    },

    sanitize: (string) => {
        return string
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;")
    }
}