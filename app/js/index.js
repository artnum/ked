
window.addEventListener('load', (event) => {
    const head = document.head

    const scripts = [
        '/Menshen/js/menshen.js',
        '../js/keditor.js',
        '../js/ktags.js',
        '../js/api.js',
        '../js/anim.js',
        '../js/document.js',
        '../js/utils.js',
        '../node_modules/quill/dist/quill.min.js',
        '../node_modules/jsqr/dist/jsQR.js',
        '../node_modules/lightbox2/dist/js/lightbox-plus-jquery.min.js'
    ]

    const moduleScripts = [
        '../js/quill.js',
    ]

    const csss = [
        '../css/keditor.css',
        '../css/ktags.css',
        '../css/kdocument.css',
        '../node_modules/@fortawesome/fontawesome-free/css/all.min.css',
        '../node_modules/quill/dist/quill.snow.css',
        '../node_modules/lightbox2/dist/css/lightbox.min.css'
    ]
    
    const allLoaded = []

    for (let i = 0; i < csss.length; i++) {
        const css = document.createElement('LINK')
        css.setAttribute('rel', 'stylesheet')
        css.setAttribute('href', csss[i])
        allLoaded.push(new Promise((resolve, reject) => {
            css.onerror = () => {
                resolve()
            }
            css.onload = () => {
                resolve()
            }
        }))
        head.appendChild(css)
    }

    const scriptsLoad = []
    for (let i = 0; i < scripts.length; i++) {
        const script = document.createElement('SCRIPT')
        script.src = scripts[i]
        const sload = new Promise((resolve, reject) => {
            script.onerror = () => {
                resolve()
            }
            script.onload = () => {
                resolve()
            }
        })
        allLoaded.push(sload)
        scriptsLoad.push(sload)
        head.appendChild(script)
    }

    Promise.all(scriptsLoad)
    .then (() => {
        for (let i = 0; i < moduleScripts.length; i++) {
            const script = document.createElement('SCRIPT')
            script.src = moduleScripts[i]
            script.type = 'module'
            allLoaded.push(new Promise((resolve, reject) => {
                script.onerror = () => {
                    resolve()
                }
                script.onload = () => {
                    resolve()
                }
            }))
            head.appendChild(script)
        }

        Promise.all(allLoaded)
        .then(() => { window.dispatchEvent(new CustomEvent('keditor-loaded')) })
    })
})