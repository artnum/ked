
window.addEventListener('load', (event) => {
    const head = document.head

    const scripts = [
        '../js/keditor.js',
        '//cdn.quilljs.com/1.3.6/quill.js'
    ]

    const csss = [
        '../css/keditor.css',
        '../node_modules/@fortawesome/fontawesome-free/css/all.min.css',
        '//cdn.quilljs.com/1.3.6/quill.snow.css'
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

    for (let i = 0; i < scripts.length; i++) {
        const script = document.createElement('SCRIPT')
        script.src = scripts[i]
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