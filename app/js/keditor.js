function KEditor(container, baseUrl) {
    this.Print = new KEDPrint(this, window.document.location)
    this.API = new KEDApi(baseUrl)
    this.Inactivity = new KEDActivity(5)
    this.localLocked = new Map()
    this.container = container
    this.baseUrl = baseUrl
    this.cwd = ''

    this.title = KED.title ?? 'Sans titre'
    
    this.previousTitles = []
    this.previousPath = []

    this.tags = new Map()
    this.LockedNotFound = new Map()
    this.quillOpts = {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],        // toggled buttons
              
                [{ 'header': 1 }, { 'header': 2 }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }, {'list': 'check'}],
                [{ 'script': 'sub'}, { 'script': 'super' }],      // superscript/subscript
              
                [{ 'size': ['small', false, 'large', 'huge'] }],  // custom dropdown
                [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
              
                [{ 'color': [] }, { 'background': [] }],          // dropdown with defaults from theme
                [{ 'align': [] }],
              
                ['clean']                                         // remove formatting button
              ]
        }
    }

    this.data = new Map()
    this.editors = new Map()

    /* bind edit function to this ... not sure of that but it works */
    for (let k in this.edit) {
        this.edit[k] = this.edit[k].bind(this)
    }

    this.API.addEventListener('uploaded', this.handledUploaded.bind(this))

    //this.container.addEventListener('click', this.interact.bind(this))
    window.addEventListener('popstate', event => {
        if (event.state === null) { this.setPath('') }
        else { 
            this.popingState = true
            this.setTitle(event.state.title)
            switch (event.state.type) {
                case 'path':
                    for(const tag of this.tags) {
                        tag[1].unset()
                    }
                    this.cwd = event.state.content
                    this.clear()
                    this.ls()
                    break
                case 'tags':
                    const tags = event.state.content
                    for(const tag of this.tags) {
                        if (tags.indexOf(tag[1].tag) === -1) {
                            tag[1].unset()
                        } else {
                            tag[1].set()
                        }
                    }
                    this.selectedTag()
                    break
                case 'search':
                    this.search(this.json2FormData(event.state.content))
                    break

            }
        }
    })
    if (window.location.search !== '') {
        this.cwd = String(window.location.search).substring(1)
        this.pushState('path', this.cwd)
    } else {
        this.pushState('path', '', this.title)
    }
    window.addEventListener('hashchange', event => {
        if (window.location.hash.startsWith('#menshen-')) {
            this.authStart()
        }
        if (window.location.hash.startsWith('#name-')) {
            this.highlight(String(window.location.hash).split('-')[1])
        }
    })

    if (window.location.hash.startsWith('#name-')) {
        this.highlight(String(window.location.hash).split('-')[1])
    }

    /* client id is for each browser */
    this.API.getClientId()
    .then(clientid => {
        this.clientid = clientid
        this.authStart()
    })
    this.API.addEventListener('error', (event) => {
        this.error(event.message)
    })

    if (lightbox) {
        lightbox.option({
            wrapAround: true
        })
    }

    this.API.addEventListener('upload-state', event => {
        const upstate = event.detail
        switch (upstate.state) {
            default:
            case 'none': 
                this.showUploadStatus('none', [])
                return;
            case 'progress':
                this.showUploadStatus('progress', upstate.files)
                return 
            case 'preparation':
                this.showUploadStatus('preparation', [])
                return
            case 'disconnected':
                this.showUploadStatus('disconnected', [])
                return
        }
    })
}

KEditor.prototype.showUploadStatus = function (state, files) {
    const upload = document.getElementById('KEDUploadDisplay') || document.createElement('DIV')
    upload.addEventListener('click', event => {
        switch (event.target?.dataset?.action) {
            case 'cancel': this.API.cancelUpload(); break
        }
    })
    upload.id = 'KEDUploadDisplay'
    if (state === 'none') {
        if (upload.parentNode) { upload.parentNode.removeChild(upload) }
        return
    }
    if (state === 'disconnected') {
        upload.innerHTML = `
            <span>Réseau déconnecté, envoi suspendu</span><button class="kui" data-action="cancel">Arrêter</span>
            <div style="width: 0%">&nbsp</div>`
        upload.classList.add('disconnect')
        if (!upload.parentNode) {
            this.container.appendChild(upload)
        }
        return 
    }
    upload.classList.remove('disconnect')
    if (state === 'preparation') {
        upload.innerHTML = `
            <span>Envoi de fichier(s) en préparation</span>
            <div style="width: 0%">&nbsp</div>`
        if (!upload.parentNode) {
            this.container.appendChild(upload)
        }
        return 
    }

    let tot = 0
    let left = 0
    for (const f of files) {
        tot += f.max
        left += f.left
    }
    const percent = 100 - Math.round(left * 100 / tot)
    upload.innerHTML = `
        <span>${files.length} fichier${files.length > 1 ? 's' : ''} en cours de chargement (${percent} %)</span><button class="kui" data-action="cancel">Arrêter</span>
        <div style="width: ${percent}%">&nbsp</div>`
    if (!upload.parentNode) {
        this.container.appendChild(upload)
    }
}

KEditor.prototype.handledUploaded = function (event) {
    const content = event.detail

    this.refreshDocument(content.content.path)
}

KEditor.prototype.formData2Json = function (formData) {
    const object = {}
    for (const k of formData.keys()) {
        object[k] = formData.get(k)
    }
    return JSON.stringify(object)
}

KEditor.prototype.json2FormData = function (jsonForm) {
    const object = JSON.parse(jsonForm)
    const formData = new FormData()
    for (const k in object) {
        formData.append(k, object[k])
    }
    return formData
}

KEditor.prototype.updateActiveTags = function () {
    this.API.activeTags()
    .then(result => {
        if (result.ok) { 
            this.ActiveTags = result.data.tags
        }
    })
}

KEditor.prototype.setTitle = function (title) {
    this.title = title
    document.title = `[ked] ${this.title}`
    KEDAnim.push(() => {  
        const h = this.headerMenu.getElementsByClassName('kmenu-title')[0]
        if (h) { h.innerHTML = this.title }
    })
}

KEditor.prototype.showTags = function () {
    const tagOverlay = document.createElement('DIV')
    tagOverlay.id = 'ktagOverlay'
    const keys = Object.keys(this.ActiveTags).sort((a, b) => { return a.localeCompare(b) })
    for (const tag of keys) {
        let ktag = this.tags.get(tag)
        if (!ktag) {
            ktag = new KTag(tag)
            this.tags.set(tag, ktag)
            ktag.addEventListener('change', _ => {
                this.selectedTag()
            })
        }
        tagOverlay.appendChild(ktag.html(`(${this.ActiveTags[tag].count})`))
    }
    const closeButton = document.createElement('BUTTON')
    closeButton.innerHTML = 'Fermer'
    closeButton.classList.add('kui')
    closeButton.addEventListener('click', () => {
        KEDAnim.push(() => {
            document.body.removeChild(document.getElementById('ktagOverlay'))
            document.body.classList.remove('noscroll')
        })
    })
    tagOverlay.appendChild(closeButton)
    KEDAnim.push(() => {
        document.body.appendChild(tagOverlay)
        document.body.classList.add('noscroll')
    })
}

KEditor.prototype.setupPage = function () {
    this.updateActiveTags()
    setInterval(this.updateActiveTags.bind(this), 60000)
    this.pathDisplay = document.createElement('DIV')
    this.pathDisplay.classList.add('kpath')
    this.pathDisplay.innerHTML = '&nbsp;'
    this.container.appendChild(this.pathDisplay)
    this.headerMenu = document.createElement('DIV')
    this.headerMenu.classList.add('kmenu')
    this.headerMenu._tools = '<div class="ktool"><div class="tools"><button class="kui" data-action="add-document"><i class="fas fa-folder-plus"></i> Nouveau document</button></div>' +
        '<div class="tools"><button class="kui" data-action="show-tags"><i class="fas fa-tags"> </i>&nbsp;Liste des tags</button></div>' +
        '<div class="search"><form name="search"><input class="kui" type="text" name="search" value=""/> <button class="kui" type="submit">Rechercher</button></form></div></div>'
    this.headerMenu.addEventListener('click', this.menuEvents.bind(this))
    this.headerMenu.addEventListener('submit', this.menuFormSubmit.bind(this))
    this.container.appendChild(this.headerMenu)
    this.container.classList.add('keditorRoot')
}

KEditor.prototype.sseSetup = function() {
    const cuEvent = (data) => {
        try {
            if (!data.id) { return; }
            new Promise(resolve => {
                if (data.clientid) {
                    this.API.getClientId()
                    .then(clientid => {
                        if (data.clientid === clientid) { resolve(false) ;}
                        else { resolve(true) }
                    })
                } else {
                    resolve(true)
                }
            })
            .then(process => {
                if (!process) { return; }
                const element = document.querySelector(`div[data-pathid="${data.id}"]`)
                if (element) {
                    this.refreshDocument(element.id)
                }
            })
        } catch (e) {
            this.error(e)
        }
    }

    const url = new URL('./events.php', this.baseUrl)
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(
        (new Date().getTime()).toString() + (performance.now()).toString() + (navigator.userAgent).toString()
    ))
    .then(id => {
        return this.API.Menshen.qstring(
            url,
            'get',
            MenshenEncoding.buf2b64(id)
        )
    })
    .then(url => {
        url.searchParams.append('clientid', this.clientid)
        this.sse = new EventSource(url)
        this.sse.onmessage = event => {
            const message = JSON.parse(event.data)
            switch (message.operation) {
                case 'create':
                case 'update':
                    cuEvent(message)
                    break;
                case 'lock':
                case 'unlock':
                    this.lockUnlock(message);
                    break
            }
        }      
        this.sse.addEventListener('error', event => {
            this.sse.close()
            this.sse = null
            setTimeout(() => {
                this.sseSetup()
            }, 15000)
        })
    })
}

KEditor.prototype.authForm = function (nextTry = false) {
    const form = document.getElementById('KEDAuthForm') || document.createElement('FORM')
    KEDAnim.push(() => {
        form.innerHTML = `<div>
            ${nextTry ? '<div class="error">Erreur d\'authentification</div>' : ''}
            <label for="username"><span>Nom d'utilisateur :</span><input type="text" name="username" value=""></label><br>
            <label for="password"><span>Mot de passe :</span><input type="password" name="password" value=""></label><br>
            <label for="keyfile" id="privImport" style="display: none"><span>Clé privée :</span><input type="file" name="keyfile"></label><br>
            <button type="submit">Authentifier</button>
            </div>`
    })
    if (!form.parentNode) {
        form.id = 'KEDAuthForm'
        document.body.appendChild(form)
        form.addEventListener('change', event => {
            const data = new FormData(form)
            if (data.get('username')) {
                this.API.hasKey(data.get('username'))
                .then(has => {
                    if (!has) {
                        form.dataset.importAuth = '1'
                        document.getElementById('privImport').style.removeProperty('display')
                    } else {
                        form.dataset.importAuth = '0'
                        document.getElementById('privImport').style.setProperty('display', 'none')
                    }
                })
            }
        })
        form.addEventListener('submit', event => {
            event.preventDefault()
            const data = new FormData(form)
            if (form.dataset.importAuth === '1') {
                this.API.setPassword(data.get('password'))
                .then(() => {
                    const file = data.get('keyfile')
                    if (file) {
                        reader = new FileReader()
                        reader.addEventListener('loadend', event => {
                            this.API.importAuth(data.get('username'), event.target.result)
                            .then(() => {
                                this.authNext(data.get('username'), data.get('password'))
                            })
                        })
                        reader.readAsArrayBuffer(file)
                        return
                    } else {
                        this.authForm(true)
                    }
                })
            } else {
                this.authNext(data.get('username'), data.get('password'))
            }
        })
    }
}

KEditor.prototype.authStop = function () {
    localStorage.removeItem(`KED/username@${this.baseUrl}`)
    localStorage.removeItem(`KED/password@${this.baseUrl}`)
    this.API.logout()
}

KEditor.prototype.authStart = function () {
    const hash = window.location.hash || LoadHash
    if (hash.startsWith('#menshen-')) {
        const authData = hash.substring(9).split('@')
        const pemkey = authData[1].replaceAll('-', '+').replaceAll('_', '/').replaceAll('.', '=')
        const key = MenshenEncoding.base64Decode(pemkey)
        this.API.importAuth(authData[0], key)
        .then(() => {
            this.authNext(authData[0], '')
        })
        .catch(reason => {
            this.error(reason)
        })
    } else {
        const username = localStorage.getItem(`KED/username@${this.baseUrl}`)
        const password = localStorage.getItem(`KED/password@${this.baseUrl}`)
        if (!username) {
            this.authForm()
        } else {
            this.authNext(username, JSON.parse(password))
        }
    }
}

KEditor.prototype.authNext = function (username, password) {
    this.API.init(username, password)
    .then(inited => {
        if (inited) {
            return this.API.getUser()
        }
        return {ok: false}
    })
    .then(result => {
        if (!result.ok) {
            this.authForm(true)
            return
        }
        this.User = result.data
        localStorage.setItem(`KED/username@${this.baseUrl}`, username)
        this.API.getPass()
        .then(pass => {
            localStorage.setItem(`KED/password@${this.baseUrl}`, JSON.stringify(pass))
        })
        const form = document.getElementById('KEDAuthForm')
        if (form) {
            KEDAnim.push(() => {
                if (form.parentNode) {
                    form.parentNode.removeChild(form) 
                }
            })
        }
        this.setupPage()
        this.sseSetup()
        this.ls()
    })
}

KEditor.prototype.lockUnlock = function(data) {
    try {
        if (data.clientid === this.clientid) { return }
        const kedDoc = KEDDocument.search(data.id)
    
        switch(data.operation) {
            case 'lock': 
                if (kedDoc) {
                    kedDoc.receiveLock(data.clientid);
                } else {
                    this.LockedNotFound.set(data.id, data.clientid)
                }
                break
            case 'unlock':
                this.LockedNotFound.delete(data.id)
                if (kedDoc) {
                    kedDoc.receiveUnlock(data.clientid);
                }
                break
        }
        
    } catch (e) {
        console.log(e)
    }
}

KEditor.prototype.fetch = function (path, content) {
    return new Promise((resolve, reject) => {
        if (path.length > 0) { path = `/${path}` }
        let url = new URL(`${this.baseUrl.toString()}${path}`)
        this.API.fetch(url, {'method': 'POST',
            body: content instanceof FormData ? content : JSON.stringify(content)
        })
        .then(response => {
            if (!response.ok) {
                const ret = { 
                    ok: false,
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
                return ret
                
            }
            return response.json()
        })
        .then(result => {
            resolve({ok: true, data: result})
        })
        .catch(reason => {
            console.log(reason)
            resolve({ok: false, data: reason})
        })
    })
}

KEditor.prototype.highlight = function (id) {
    this.toHighlight = id
    this.doHighlight(id)
}

KEditor.prototype.doHighlight = function (id) {
    const node = document.querySelector(`[data-pathid="${this.toHighlight}"]`) || document.getElementById(this.toHighlight)
    if (node) {
        setTimeout(() => { node.scrollIntoView() }, 1000)
        KEDAnim.push(() => {
            node.classList.add('highlight')
        })
        .then(_ => {
            setTimeout(() => {
                KEDAnim.push(() => {
                    node.classList.remove('highlight')
                })
            }, 5000)
        })
    }
}

KEditor.prototype.error = function (data) {
    let str = ''
    const errorDiv = document.createElement('DIV')
    errorDiv.classList.add('kederror')
    if (data instanceof Error) {
        str = data.message
    } else if (typeof data === 'string') {
        str = data
    } else {
        str = 'Erreur inconnue'
    }
    errorDiv.innerHTML = `<form><i class="fas fa-exclamation-circle"> </i><span class="message">${str}</span><button class="kui" type="submit">Ok</button></form>`
    KEDAnim.push(() => {
        this.container.insertBefore(errorDiv, this.container.firstElementChild)
    })
    errorDiv.addEventListener('submit', (event) => {
        event.preventDefault()
        event.stopPropagation()
        let node = event.target
        while (node && !node.classList.contains('kederror')) { node = node.parentNode }
        if (!node.parentNode) { return }
        KEDAnim.push(() => {
            node.parentNode.removeChild(node)
        })
    }, {capture: true})
}

KEditor.prototype.refreshDocument = function (docPath) {
    return new Promise((resolve, reject) => {
        this.API.getDocument(docPath)
        .then(doc => {
            if (!doc) { return }
            return this.renderSingle(doc)
        })
        .then(_ => resolve())
        .catch(reason => reject(reason))
    })
}

KEditor.prototype.ls = function () {
    return new Promise((resolve, reject) => {
        this.API.listDocument(this.cwd)
        .then(result =>{
            if (!result.ok) { this.error(result.data); return }
        
            if (this.cwd !== '') {
                const cwd = this.cwd
                this.API.getInfo(cwd)
                .then(info => {
                    this.setTitle(info?.name)
                    this.pushState('path', cwd)
                })
            } else {
                this.setTitle(KED.title ?? 'Sans titre')
            }

            return this.render(result.data)
        })
        .then(_ => resolve())
        .catch(reason => reject(reason))
    })
}

KEditor.prototype.resetTag = function () {
    for (const tag of this.tags) {
        tag[1].unset()
    }
}

KEditor.prototype.selectedTag = function (event) {
    const tags = []
    for(const tag of this.tags) {
        if (tag[1].state) {
            tags.push(tag[1].tag)
        }
    }
    this.pushState('tags', tags)
    this.setTitle(tags.map(t => `#${t}`).join(', '))
    if (tags.length === 0) {
        return this.ls()
    }
    this.API.searchByTags(tags)
    .then(result => {
        if (!result.ok) { this.error(result.data); return}
        return this.render(result.data)
    })
}

KEditor.prototype.pushState = function (type, content, title = undefined) {
    /* popstate set this flag, so we avoid pushing the same state when coming from popstate */
    if (this.popingState) { this.popingState = false; return }
    let url
    
    if (type === 'path') {
        path = (content === undefined || content === null) ? this.cwd : content
        url = `${String(window.location).split('?')[0]}${this.cwd === '' ? '' : '?'}${path}`
        if (window.location.hash) {
            const hash = String(window.location.hash).split('#')[1]
            url += `#${hash}`
        }
    } else {
        url = String(window.location)
    }
    history.pushState({
        type,
        content,
        title: title || this.title
    }, 'KED', url)
}

KEditor.prototype.replaceState = function () {
    const url = `${String(window.location).split('?')[0]}${this.cwd === '' ? '' : '?'}${this.cwd}`
    history.replaceState({path: this.cwd}, 'KED', url)
}

KEditor.prototype.setPath = function (path) {
    this.cwd = path
}

KEditor.prototype.renderPath = function () {
    if (this.previousTitles.length > 0) {
        this.pathDisplay.innerHTML = this.previousTitles.join(' » ')
    } else {
        this.pathDisplay.innerHTML = '&nbsp;'
    }
}

KEditor.prototype.reset = function () {
    if (window.location.hash !== '') { window.location.hash = ''}
    this.previousPath = []
    this.previousTitles = []
    this.pushState('path', '')
    this.renderPath()
}

KEditor.prototype.backward = function () {
    if (window.location.hash !== '') { window.location.hash = ''}
    this.previousTitles.pop()
    this.renderPath()
    const previousPath = this.previousPath.pop() ?? ''
    if (previousPath === '') { this.pushState('path', '') }
    return previousPath
}

KEditor.prototype.forward = function () {
    if (window.location.hash !== '') { window.location.hash = ''}
    this.previousPath.push(this.cwd)
    this.previousTitles.push(this.title)
    this.renderPath()
}

KEditor.prototype.cd = function (abspath) {
    return new Promise((resolve, reject) => {
        this.API.check(abspath, 'list-document')
        .then (can => {
            if (can) {
                this.forward()
                this.cwd = abspath
                resolve()
            } else {
                reject(new Error('Accès non-autorisé'))
            }
        })
        .catch(reason => { reject(reason) })
    })
    
}

KEditor.prototype.interact = function (event) {
    let node = event.target
    while (node && !node.dataset?.pathid) {
        node = node.parentNode
    }
    if (!node) { return }
    switch (event.type) {
        case 'click':
            if (node.dataset.childs <= 0) { return }
            this.cd(node.id)
            .then(() => {         
                window.history.pushState({type: 'path', content: this.cwd}, '')
                this.ls()
            })
            .catch(reason => this.error(reason))
            break
    }
}

KEditor.prototype.buildPath = function (comp0, comp1) {
    if (comp0 === '') { return comp1 }
    if (comp1 === '') { return comp0 }
    if (comp0 !== ',') { return `${comp0},${comp1}`}
}

KEditor.prototype.updateEntry = function (entryId) {
    this.API.getEntry(entryId)
    .then(result => {
        return result.data.entry
    })
    .then(entry => {
        return this.renderEntry(`${this.baseUrl.toString()}/`, entry)
    })
    .then(domNode => {
        const oldDom = document.getElementById(domNode.id)
        if (oldDom) {
            KEDAnim.push(() => {
                oldDom.parentNode.replaceChild(domNode, oldDom)
            })
        }
    })
}

KEditor.prototype.edit = {
    quills: function (contentNode, docNode) {
        return new Promise(resolve => {
            if (contentNode.dataset.edition) {
                resolve(false)
                const quill = this.editors.get(contentNode.dataset.entryid)
                this.uploadText(contentNode, JSON.stringify(quill.getContents()), 'text/x-quill-delta')
                .then(result => {
                    this.editors.delete(contentNode.dataset.entryid)
                    delete quill
                    delete contentNode.dataset.edition
                    if (result.ok) {
                        this.updateEntry(result.data.id)
                    }
                })
                return;
            }
            resolve(true)
            contentNode.innerHTML = '<div></div>'
            contentNode.dataset.edition = '1'
            let content = this.data.get(contentNode.dataset.entryid)
            const quill = new Quill(contentNode.firstElementChild, this.quillOpts)
            quill.setContents(content)
            this.editors.set(contentNode.dataset.entryid, quill)
        })
    },
    text: function (contentNode) {
        return new Promise(resolve => {
            if (contentNode.dataset.edition) {
                resolve(false)
                this.uploadText(contentNode, contentNode.firstElementChild.value, 'text/plain')
                .then(result => {
                    delete contentNode.dataset.edition
                    if (result.ok) {
                        this.updateEntry(result.data.id)
                    }
                })
                return;
            }
            resolve(true)
            contentNode.dataset.edition = '1'
            let content = this.data.get(contentNode.dataset.entryid)
            contentNode.innerHTML = '<textarea style="width: calc(100% - 8px); height: 380px"></textarea>'
            contentNode.firstElementChild.value = content
            
        })
    },
    file: function (contentNode) {
        return new Promise(resolve => {
            resolve(false)
            this.uploadFileInteract(contentNode)
        })
    }
}

KEditor.prototype.renderEntry = function (path, entry) {
    let oname = entry.application?.find(value => value.startsWith('ked:name='))
    if (oname) { oname = oname.split('=')[1] }
    const EntryName = oname ?? ''
    return new Promise ((resolve, reject) => {
        const subresolve = function (htmlnode) {
            htmlnode.dataset.entryid = entry.id
            htmlnode.id = entry.abspath
            if (entry.user) {
                htmlnode.dataset.users = JSON.stringify(entry.user)
            }
            if (entry['+class'].indexOf('task') !== -1) {
                htmlnode.dataset.task = '1'
            }
            htmlnode.classList.add('content')
            htmlnode.dataset.name = EntryName
            if (entry.description) { htmlnode.dataset.description = entry.description }
            resolve(htmlnode)
        }

        if (!entry.type) { resolve(null); return; }
        let htmlnode;
        let subtype = entry.type.split('/', 2)
        Promise.all([
            this.API.getUrl(`${path}/${entry.abspath}?mod=${entry.modified}`),
            this.API.getUrl(`${path}/${entry.abspath}!browser?mod=${entry.modified}`)
        ])
        .then(([url1, url2]) => {
            switch(subtype[0]) {
                case 'video':
                    htmlnode = document.createElement('VIDEO')
                    htmlnode.src = url1
                    htmlnode.classList.add('kvideo')
                    htmlnode.setAttribute('width', '200px')
                    htmlnode.setAttribute('height', '200px')
                    htmlnode.setAttribute('controls', '')
                    htmlnode.dataset.edit = 'file'
                    subresolve(htmlnode)
                    return
                case 'image':
                    htmlnode = document.createElement('A')
                    htmlnode.href = url1
                    htmlnode.target = '_blank'
                    htmlnode.dataset.lightbox = `${path}`
                    htmlnode.dataset.title = oname || ''
                    htmlnode.style.backgroundImage = `url('${url2}')`
                    htmlnode.style.backgroundSize = 'cover'
                    htmlnode.classList.add('klink')
                    htmlnode.dataset.edit = 'file'
                    subresolve(htmlnode)
                    return
                case 'text':
                    this.API.fetch(new URL(`${path}/${entry.abspath}?mod=${entry.modified}`))
                    .then(response => {
                        if (!response.ok) { resolve(null); return; }
                        response.text()
                        .then(content => {
                            let type = entry.type
                            subtype = type.split('/', 2)
                            if (subtype[1] === undefined) { resolve(null); return }
                            switch (subtype[1]) {
                                case 'html':
                                    let x = document.createElement('HTML')
                                    x.innerHTML = content
                                    htmlnode = document.createElement('DIV')
                                    htmlnode.innerHTML = x.getElementsByTagName('BODY')[0].innerHTML
                                    htmlnode.classList.add('htmltext')
                                    subresolve(htmlnode)
                                    return
                                case 'x-quill-delta':
                                    /* we display a transformed version, so keep data as original form */
                                    this.data.set(entry.id, JSON.parse(content))
                                    const tmpContainer = document.createElement('DIV')
                                    const quill = new Quill(tmpContainer)
                                    quill.setContents(this.data.get(entry.id))
                                    htmlnode = document.createElement('DIV')
                                    htmlnode.innerHTML = quill.root.innerHTML
                                    htmlnode.classList.add('quilltext')
                                    htmlnode.dataset.edit = 'quills'
                                    subresolve(htmlnode)
                                    return
                                default:
                                    this.data.set(entry.id, content)
                                    htmlnode = document.createElement('DIV')
                                    htmlnode.innerHTML = content
                                    htmlnode.classList.add('plaintext')
                                    htmlnode.dataset.edit = 'text'
                                    subresolve(htmlnode)
                                    return
                            }
                        })
                        .catch(_ => resolve(null))
                    })
                    .catch(_ => resolve(null))
                    return
                default: 
                    switch (entry.type) {
                        default:
                            htmlnode = document.createElement('A')
                            htmlnode.classList.add('klink')
                            htmlnode.target = '_blank'
                            htmlnode.href = url1
                            htmlnode.innerHTML = `<span class="name">${EntryName}</span>`
                            htmlnode.dataset.edit = 'file'
                            subresolve(htmlnode)
                            return
                        case 'application/pdf':
                            htmlnode = document.createElement('A')
                            htmlnode.href = url1
                            htmlnode.target = '_blank'
                            htmlnode.style.backgroundImage = `url('${url2}')`
                            htmlnode.style.backgroundSize = 'cover'
                            htmlnode.classList.add('klink')
                            htmlnode.dataset.edit = 'file'
                            subresolve(htmlnode)
                            return                       
                        case 'message/rfc822':
                            this.API.fetch(new URL(`${path}/${entry.abspath}?mod=${entry.modified}`))
                            .then(response => {
                                if (!response.ok) { return null; }
                                return response.text()
                            })      
                            .then(content => {
                                if (content === null) { return; }
                                let x = document.createElement('HTML')
                                x.innerHTML = content
                                htmlnode = document.createElement('DIV')
                                htmlnode.innerHTML = x.getElementsByTagName('BODY')[0].innerHTML
                                htmlnode.classList.add('htmltext')
                                subresolve(htmlnode)
                                return
                            })
                            break;
                    }
            }
        })
        .catch(reason => {
            reject(reason)
        })
    })
}

KEditor.prototype.deleteEntryInteract = function (docNode, entryNode) {
    return new Promise((resolve, reject) => {
        const formNode = document.createElement('FORM')
        formNode.classList.add('kform-inline')
        formNode.addEventListener('submit', event => {
            event.preventDefault()
            const fdata = new FormData(event.target)
            event.target.parentNode.removeChild(event.target)
            resolve(true)
        })
        formNode.addEventListener('reset', event => {
            event.target.parentNode.removeChild(event.target)
            resolve(false)
        })
        formNode.innerHTML = `<span class="message">Voulez-vous supprimer cette entrée</span><button type="submit">Oui</button><button type="reset">Non</button>`
        entryNode.parentNode.appendChild(formNode)
    })
    .then (confirm => {
        if (confirm) {
            this.API.delete(entryNode.id)
            .then(_ => {
                const node = document.getElementById(`container-${entryNode.id}`)
                KEDAnim.push(() => {
                    if (node) { node.parentNode.removeChild(node) }
                })
            })
        }
    })

}

KEditor.prototype.deleteDocumentInteract = function (docNode) {
    new Promise((resolve, reject) => {
        const formNode = document.createElement('FORM')
        formNode.classList.add('kform-inline')
        formNode.addEventListener('submit', event => {
            event.preventDefault()
            const fdata = new FormData(event.target)
            event.target.parentNode.removeChild(event.target)
            resolve(true)
        })
        formNode.addEventListener('reset', event => {
            event.target.parentNode.removeChild(event.target)
            resolve(false)
        })
        formNode.innerHTML = `<span class="message">Voulez-vous supprimer ce document</span><button type="submit">Oui</button><button type="reset">Non</button>`
        docNode.insertBefore(formNode, docNode.getElementsByClassName('kmetadata')[0].nextElementSibling)
    })
    .then (confirm => {
        if (confirm) {
            this.deleteDocument(docNode)
            this.clear()
            this.ls()
        }
    })
}

KEditor.prototype.deleteDocument = function (docNode) {
    this.API.delete(docNode.id)
    .then(result => {
        if (result.ok) {
            const doc = KEDDocument.registered(result.data.path)
            if (doc) { doc.remove() }
        }
    })
}

KEditor.prototype.addDocument = function (title = null, path = null, parent = null) {
    title = title || 'Sans titre'
    path = path || this.cwd
    tags = parent !== null ? parent.getTags() : []
    this.API.createDocument(title, path, tags)
    .then(result => {
        if (!result.ok) { return }
        return KEDDocument.get(result.data.id, this.API)
    })
    .then(kedDoc => {
        if (kedDoc) {
            kedDoc.highlight(5)
        }
        this.ls()
    }) 
}

KEditor.prototype.dropEntry = function (event) {
    event.preventDefault()
    let docNode  = event.target
    while (docNode && !docNode.dataset?.pathid) { docNode = docNode.parentNode }
    if (!docNode) { return }
    const files = event.dataTransfer
    const getDoc = KEDDocument.get(docNode.id, this.API)
    let itemQty = 0
    for (let i = 0; i < files.items.length; i++) {
        if (files.items[i].kind === 'file') {
            itemQty++
        }
    }
    if (itemQty === 0) { return }
    /*getDoc
    .then(doc => {
        doc.uploadStart(itemQty)
    })*/
    let allTransfers = []
    for (let i = 0; i < files.items.length; i++) {
        if (files.items[i].kind === 'file') {
            this.API
            .upload(docNode.id, files.items[i].getAsFile())
            .then(token => {
                console.log(`upload in progress ${token}`)
            })
        }
    }

    Promise.all(allTransfers)
    .then(_ => {
        this.refreshDocument(docNode.id)
        /*getDoc
        .then(doc => {
            doc.uploadEnd()
        })*/
    })
}

KEditor.prototype.menuFormSubmit = function (event) {
    event.preventDefault()
    const formData = new FormData(event.target)
    this.search(formData)
}

KEditor.prototype.search = function (formData) {
    this.pushState('search', this.formData2Json(formData))
    this.forward()
    const searchTerm = formData.get('search')
    this.setTitle(`Recherche "${searchTerm}"`)
    const operation = {
        operation: 'search',
        term: searchTerm
    }
    this.fetch('', operation)
    .then(result => {
        this.render(result.data)
    })
}

KEditor.prototype.menuEvents = function (event) {
    let actionNode = event.target

    while (actionNode && !actionNode.dataset?.action) { actionNode = actionNode.parentNode }
    if (!actionNode) { return }

    switch(actionNode.dataset.action) {
        case 'history-back': this.cwd = this.backward(); this.resetTag(); this.ls(); break
        case 'history-home': this.cwd = ''; this.reset(); this.resetTag(); this.ls(); break
        case 'add-document':  this.addDocumentInteract(this.cwd); break
        case 'show-tags': this.showTags(); break
    }
}

KEditor.prototype.docMustOpen = function (nodeId) {
    KEDDocument.get(nodeId, this.API)
    .then(kedDoc => {
        kedDoc.open()
    })
}

KEditor.prototype.submenuEvents = function (event) {
    let actionNode = event.target

    while (actionNode && !actionNode.dataset?.action) { actionNode = actionNode.parentNode }
    if (!actionNode) { return }

    let docNode = event.target
    while (docNode && !docNode.dataset?.pathid) { docNode = docNode.parentNode}
    if (!docNode) { return }

    switch (actionNode.dataset.action) {
        case 'delete-document': this.deleteDocumentInteract(docNode); break;
        case 'open-document': 
            this.cd(docNode.id)
            .then(() => {
                this.ls(); 
            })
            .catch(reason => this.error(reason))
            break
        case 'toggle-entries': this.toggleEntriesDisplay(event); break;
        case 'add-text': this.docMustOpen(docNode.id); this.addTextInteract(docNode); break
        case 'upload-file': this.docMustOpen(docNode.id); this.uploadFileInteract(docNode); break
        case 'to-task': this.convertToTaskInteract(docNode); break
        case 'to-not-task': this.convertToNotTaskInteract(docNode); break
        case 'set-task-done': this.updateTask(docNode, [[ 'taskDone', new Date().toISOString() ]]); break
        case 'set-task-undone': this.updateTask(docNode, [[ 'taskDone', '' ]]); break
        case 'add-tag': this.addTagInteract(docNode); break
    }
}

KEditor.prototype.addTagInteract = function (docNode) {
    new Promise((resolve, reject) => {
        const form = document.createElement('FORM')
        form.classList.add('kform-autocomplete')
        form.addEventListener('submit', event => {
            event.preventDefault()
            const form = new FormData(event.target)
            event.target.parentNode.removeChild(event.target)
            resolve([form.get('tag'), true])
        })
        form.addEventListener('reset', event => {
            event.target.parentNode.removeChild(event.target)
            resolve([null, false])
        })
        form.innerHTML = `<div class="kform-inline"><input type="text" placeholder="Tag" name="tag" autocomplete="off"></input>
            '<button type="submit">Ajouter</button><button type="reset">Annuler</button></div>
            <div class="ktags"></div>`
        form.firstElementChild.addEventListener('keyup', event => {
            if (event.target.value.length <= 0) { return; }
            this.API.searchTags(event.target.value, KED?.tags?.searchMaxSize)
            .then(response => {
                form.lastElementChild.innerHTML = ''
                if (!response.ok) { return; }
                if (!response.data.tags) { return; }
                if (response.data.tags.length <= 0) { return; }
                let existing = form.lastElementChild.firstElementChild
                let tags = []
                for (const tag of response.data.tags) {
                    const div = existing || document.createElement('DIV')
                    if (!existing) {
                        div.addEventListener('click', event => {
                            resolve([event.target.dataset.tag, false])
                            return;
                        })
                    }
                    div.classList.add('ktag')
                    div.dataset.tag = tag
                    div.innerHTML = `<i class="fas fa-hashtag"></i>${tag}`
                    if (!existing) { KEDAnim.push(() => { form.lastElementChild.appendChild(div) }) }
                    if (existing) { existing = existing.nextElementSibling }
                    tags.push(tag)
                }            
            })
        })
        KEDDocument.get(docNode.id, this.API)
        .then(doc => {
            doc.confirm(form)
        })
    })
    .then (([tag, create]) => {
        return new Promise(resolve => {
            if (!tag) { resolve(null); return }
            if (create) {
                this.API.createTag(tag)
                .then(result => {
                    this.addTagInteract(docNode)
                    this.addDocumentTag(docNode.id, result.data.id)
                    .then(result => {
                        resolve(result)
                    })
                })
            } else {
                this.addTagInteract(docNode)
                this.addDocumentTag(docNode.id, tag)
                .then(result => {
                    resolve(result)
                })
            }
        })
        .then(result => {
            if (!result) { return; }
            if (!result.ok) { return; }
            const ktag = new KTag(result.data.tag)
            this.tags.set(ktag.tag, ktag)
            tagNode = docNode.querySelector(`#tag-${result.data.id}`)
            KEDAnim.push(() => {
                if (tagNode) {
                    tagNode.insertBefore(ktag.html(), tagNode.firstElementChild)
                }
            })
            this.updateActiveTags()
        })
    })
    .catch(reason => {
        this.error(reason)
    })
}

KEditor.prototype.addDocumentTag = function (path, tag) {
    return new Promise((resolve, reject) => {
        if (path === null) { resolve(null); return; }
        const operation = {
            operation: 'add-document-tag',
            path,
            tag
        }
        this.fetch('', operation)
        .then(result => {
            resolve(result)
        })
        .catch(reason => {
            this.error(reason)
        })
    })   
}

KEditor.prototype.addDocumentInteract = function (path) {
    const docNode = this.headerMenu
    new Promise((resolve, reject) => {
        const formNode = document.createElement('FORM')
        formNode.classList.add('kform-inline')
        formNode.addEventListener('submit', event => {
            event.preventDefault()
            event.stopPropagation()
            const fdata = new FormData(event.target)
            event.target.parentNode.removeChild(event.target)
            resolve(fdata.get('name'))
        }, {capture: true})
        formNode.addEventListener('reset', event => {
            event.stopPropagation()
            event.target.parentNode.removeChild(event.target)
        }, {capture: true})
        formNode.innerHTML = `<input type="text" placeholder="Nom / titre" name="name" /><button type="submit">Créer</button><button type="reset">Annuler</button>`
        docNode.appendChild(formNode)
    })
    .then (title => {
        if (path !== '') {
            KEDDocument.get(path, this.API, true)
            .then(parent => {
                this.addDocument(title, path, parent)
            })
        } else {
            this.addDocument(title, path) 
        }
    })
}

KEditor.prototype.uploadFileInteract = function (docNode) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = 'multiple'
    input.addEventListener('change', (event) => { this.uploadFile(docNode, event) })
    input.click()
}

KEditor.prototype.convertToTaskInteract = function (docNode) {
    const formData = new FormData()
    formData.append('operation', 'to-task')
    if (docNode.dataset.entryid) {
        formData.append('path', this.buildPath(this.cwd, this.buildPath(docNode.id.parentid, docNode.dataset.entryid)))
    } else {
        formData.append('path', this.buildPath(this.cwd, docNode.dataset.pathid))
    }

    this.fetch('', formData)
    .then(_ => {
        this.refreshDocument(docNode.id)
    })
}

KEditor.prototype.convertToNotTaskInteract = function (docNode) {
    const formData = new FormData()
    formData.append('operation', 'to-not-task')
    if (docNode.dataset.entryid) {
        formData.append('path', this.buildPath(this.cwd, this.buildPath(docNode.dataset.parentid, docNode.dataset.entryid)))
    } else {
        formData.append('path', this.buildPath(this.cwd, docNode.dataset.pathid))
    }

    this.fetch('', formData)
    .then(_ => {
        this.refreshDocument(docNode.id)
    })
}

KEditor.prototype.updateTask = function (docNode, values = []) {
    if (values.length === 0) { return }

    const formData = new FormData()
    formData.append('operation', 'update-task')
    formData.append('path', this.buildPath(this.cwd, docNode.dataset.pathid))
    values.forEach(v => {
        switch(v[0]) {
            case 'taskDone':
            case 'taskPrevious':
            case 'taskEnd':
                formData.append(v[0], v[1])
                break;
        }
    })
    this.fetch('', formData)
    .then(_ => {
        this.refreshDocument(docNode.id)
    })
}

KEditor.prototype.uploadFile = function (node, event) {
    let docNode = node
    while (docNode && !docNode.classList.contains('document')) {
        docNode = docNode.parentNode
    }
    const files = event.target.files
    const op = node.dataset.entryid ? 'update-entry' : 'add-entry'
    const path = op === 'update-entry' ? this.buildPath(docNode.id, node.dataset.entryid) :  docNode.id
    const getDoc = KEDDocument.get(docNode.id, this.API)
   /* getDoc
    .then(doc => {
        doc.uploadStart(files.length)
    })*/
    for (let i = 0; i < files.length; i++) {
        this.API.upload(path, files[i])
        .then(token => {
            console.log(`upload in progress ${token}`)
        })
    }
}

KEditor.prototype.uploadText = function (node, content, type = 'text/plain') {
    const op = node.dataset.entryid ? 'update-entry' : 'add-entry'
    const path = op === 'update-entry' ? node.id :  this.buildPath(this.cwd, node.dataset.pathid)
    const formData = new FormData()
    const name = `${new Date().toISOString()}`
    formData.append('operation', op)
    formData.append('path', path)
    formData.append('file', new File([content], name, {type: `${type};charset=utf-8`}))
    formData.append('_filename', name)
    return this.fetch('', formData)
}

KEditor.prototype.addTextInteract = function (docNode) {
    const quillNode = document.createElement('div')
    quillNode.innerHTML = `<div></div><button class="kui">Sauver</button>`
    KEDAnim.push(() => {
        docNode.insertBefore(quillNode, docNode.firstElementChild.nextElementSibling)
    })
    .then(() => {
        const quill = new Quill(quillNode.firstElementChild, this.quillOpts)
        quillNode.lastElementChild.addEventListener('click', event => {
            clearInterval(quill.editor.timer)
            const htmlContent = quill.root.innerHTML
            const deltaContent = quill.getContents()
            delete quill
            quillNode.innerHTML = htmlContent
            const formData = new FormData()
            const name = `${new Date().toISOString()}`
            formData.append('operation', 'add-entry')
            formData.append('path', this.buildPath(this.cwd, docNode.dataset.pathid))
            formData.append('file', new File([JSON.stringify(deltaContent)], name, {type: "text/x-quill-delta;charset=utf-8"}))
            formData.append('_filename', name)
            this.fetch('', formData)
            .then(_ => {
                this.refreshDocument(docNode.id)
                .then(() => {
                    KEDAnim.push(() => { quillNode.parentNode.removeChild(quillNode) })
                })
            })
        })
    })
}

KEditor.prototype.clear = function () {
    this.clearOnRender = true
}
KEditor.prototype.editTitleInteract = function (docNode) {
    return new Promise ((resolve, reject) => {
        KEDDocument.get(docNode.id, this.API)
        .then(doc => {
            const form = document.createElement('FORM')
            const entry = docNode
            if (!entry) { return }
            form.innerHTML = `<div class="kform-inline">
                    <div class="title">Modifier le titre</div>
                    <div class="full"><input type="text" name="description" value="${doc.name || ''}"></div>
                    <div class="full"></input><button type="submit">Valider</button><button type="reset">Annuler</button></div>
                </div>`
            doc.confirm(form)
            form.addEventListener('submit', event => {
                event.preventDefault()
                const form = new FormData(event.target)
                resolve(form.get('description'))
            })
            form.addEventListener('reset', () => {
                reject()
            })
        })
    })
}

KEditor.prototype.descriptionInteract = function (entryId, docId) {
    return new Promise ((resolve, reject) => {
        KEDDocument.get(docId)
        .then(doc => {
            const form = document.createElement('FORM')
            const entry = document.getElementById(entryId)
            if (!entry) { return }
            form.innerHTML = `<div class="kform-inline">
                    <div class="full"><input type="text" name="description" value="${entry.dataset.description || ''}"></div>
                    <div class="full"></input><button type="submit">Valider</button><button type="reset">Annuler</button></div>
                </div>`
            doc.confirm(form, entryId)
            form.addEventListener('submit', event => {
                event.preventDefault()
                const form = new FormData(event.target)
                resolve(form.get('description'))
            })
            form.addEventListener('reset', () => {
                reject()
            })
        })
    })
}

KEditor.prototype.handleToolsEvents = function (event) {
    event.stopPropagation()
    let kcontainerNode = event.target
    
    let docNode = kcontainerNode
    while (docNode && !docNode.classList.contains('document')) {
        docNode = docNode.parentNode
    }
    KEDDocument.get(docNode.id, this.API)
    .then(doc => {
        doc.isLockable(this.API)
        .then(lockable => {        
            if (!lockable) { return; }

            while (kcontainerNode && !kcontainerNode.classList.contains('kentry-container')) { kcontainerNode = kcontainerNode.parentNode }
            if (!kcontainerNode) { return }

            let ktoolsNode = event.target
            while (ktoolsNode && !ktoolsNode.dataset?.action) { ktoolsNode = ktoolsNode.parentNode }
            if (!ktoolsNode) { return }

            switch(ktoolsNode.dataset.action) {
                case 'delete-entry':
                    this.deleteEntryInteract(docNode, kcontainerNode.firstElementChild)
                    break
                case 'edit-entry-description':
                    const entryId = kcontainerNode.id.split('-', 2)[1]
                    this.descriptionInteract(entryId, docNode.id)
                    .then(msg => {
                        return this.API.setEntryDescription(entryId, msg)
                    })
                    .then(_ => {
                        this.refreshDocument(docNode.id)
                    })
                    .catch(reason => {
                        // nope
                    })
                    break;
                case 'edit-entry':
                    KEDDocument.get(docNode.id, this.API)
                    .then(doc => {
                        if (!kcontainerNode.firstElementChild.dataset?.edit) { return }
                        if (!this.edit[kcontainerNode.firstElementChild.dataset.edit]) { return }
                        this.edit[kcontainerNode.firstElementChild.dataset.edit](kcontainerNode.firstElementChild, docNode)
                        .then(onEdit => {
                            if (onEdit) {
                                doc.lock(this.API)
                                const cancel = document.createElement('button')
                                cancel.innerHTML = '<i class="fas fa-ban"> </i>&nbsp;Annuler'
                                cancel.classList.add('kui', 'small')
                                cancel.dataset.action = 'stop-edit'
                                KEDAnim.push(() => {
                                    ktoolsNode.innerHTML = '<i class="fas fa-save"> </i>&nbsp;Enregistrer' 
                                    ktoolsNode.parentNode.insertBefore(cancel, ktoolsNode.nextElementSibling)
                                })
                                this.Inactivity.set(docNode.id, () => {
                                    this.edit[kcontainerNode.firstElementChild.dataset.edit](kcontainerNode.firstElementChild, docNode)
                                    doc.unlock(this.API)
                                    KEDAnim.push(() => {
                                        ktoolsNode.innerHTML = '<i class="fas fa-edit"> </i>&nbsp;Éditer' 
                                        if (ktoolsNode.nextElementSibling.dataset.action === 'stop-edit') {
                                            ktoolsNode.parentNode.removeChild(ktoolsNode.nextElementSibling)
                                        }
                                    })
                                })
                            } else {
                                doc.unlock(this.API)
                                KEDAnim.push(() => {
                                    ktoolsNode.innerHTML = '<i class="fas fa-edit"> </i>&nbsp;Éditer' 
                                    if (ktoolsNode.nextElementSibling.dataset.action === 'stop-edit') {
                                        ktoolsNode.parentNode.removeChild(ktoolsNode.nextElementSibling)
                                    }
                                })
                                this.Inactivity.remove(docNode.id)
                            }
                        })
                    })
                    break;
                case 'stop-edit':
                    KEDDocument.get(docNode.id, this.API)
                    .then(doc => {
                        doc.unlock(this.API)
                        this.API.getEntry(kcontainerNode.id.split('-', 2)[1])
                        .then(result => {
                            return result.data.entry
                        })
                        .then(entry => {
                            return this.renderEntry(`${this.baseUrl.toString()}/`, entry)
                        })
                        .then(domNode => {
                            const oldNode = document.getElementById(domNode.id)
                            let editButton = ktoolsNode
                            while (editButton && editButton.dataset.action !== 'edit-entry') { editButton = editButton.previousElementSibling }
                            KEDAnim.push(() => {
                                oldNode.parentNode.replaceChild(domNode, oldNode)
                                if (editButton) { editButton.innerHTML = '<i class="fas fa-edit"> </i>&nbsp;Éditer' }
                                ktoolsNode.parentNode.removeChild(ktoolsNode)
                            })
                        })
                    })
                    break
                case 'to-task':
                    this.convertToTaskInteract(kcontainerNode.firstElementChild)
                    break;
                case 'to-not-task':
                    this.convertToNotTaskInteract(kcontainerNode.firstElementChild)
                    break;
            }
        })
    })
}

KEditor.prototype.toggleEntriesDisplay = function (kedDocument) {
    if (kedDocument.isOpen()) {
        this.API.getInfo(kedDocument.getId())
        .then(doc => {
            kedDocument.close()
            this.renderSingle(doc)
        })
    } else {
        kedDocument.open()
        this.API.getDocument(kedDocument.getId())
        .then(doc => {
            this.renderSingle(doc)
        })
    }
}

KEditor.prototype.renderSingle = function (doc, level) {
    return new Promise((resolve, reject) => {
        (new Promise((resolve, reject) => {
            let htmlnode
            if (!doc) { reject(); return; }
            doc.class = 'document'
            const task = {
                is: doc['+class'].indexOf('task') === -1 ? false : true,
                done: false,
                end: null,
                previous: null
            }
            if (task.is) {
                if (doc['taskDone'] !== undefined) {
                    task.done = true
                }
            }

            let date = new Date(doc.created)
            if (isNaN(date.getTime())) {
                date = new Date()
            }
            let refresh = true
            const kedDocument = new KEDDocument(doc, this.API)
            if (this.LockedNotFound.has(kedDocument.getRelativeId())) {
                kedDocument.receiveLock(this.LockedNotFound.get(kedDocument.getRelativeId()))
                this.LockedNotFound.delete(kedDocument.getRelativeId())
            }
        
            kedDocument.addEventListener('edit-title', (event) => {
                this.editTitleInteract(event.detail.target.getDomNode())
                .then(title => {
                    return this.API.updateDocument(event.detail.target.getId(), title)
                })
                .then(result => {
                    this.refreshDocument(result.path)
                })
            })
            kedDocument.addEventListener('delete-document', (event) => { this.deleteDocumentInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('open-document', (event) => { 
                this.cd(event.detail.target.getId())
                .then(() => {
                    this.ls()
                })
                .catch(reason => this.error(reason))
            })
            kedDocument.addEventListener('print-document', event => {
                KEDDocument.get(event.detail.target.getId(), this.API)
                .then(kdoc => {
                    const output = window.open('', `print_${kdoc.getId()}`)
                    this.Print.kdoc(kdoc, output)
                })
            })
            kedDocument.addEventListener('toggle-entries', (event) => { this.toggleEntriesDisplay(event.detail.target) })
            kedDocument.addEventListener('add-text', (event) => { this.docMustOpen(event.detail.target.getId()); this.addTextInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('upload-file', (event) => { this.docMustOpen(event.detail.target.getId()); this.uploadFileInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('add-tag', (event) => { this.addTagInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('drop', this.dropEntry.bind(this))

            htmlnode = kedDocument.getDomNode()
            htmlnode.classList.add(level)
            const tagNode = htmlnode.querySelector(`#tag-${kedDocument.getRelativeId()}`)
            for (const tag of doc.tags) {
                let ktag = this.tags.get(tag)
                if (!ktag) {
                    ktag = new KTag(tag)
                    ktag.addEventListener('change', this.selectedTag.bind(this))
                    this.tags.set(tag, ktag)
                }
                tagDom = tagNode.querySelector(`[data-tagid="${tag}"]`)
                if (tagDom) {
                    if (ktag.state) {
                        tagDom.classList.add('selected')
                    } else {
                        tagDom.classList.remove('selected')
                    }
                } else {
                    tagNode.insertBefore(ktag.html(), tagNode.firstElementChild)
                }
            }
            if (!refresh) { htmlnode.addEventListener('click', this.submenuEvents.bind(this)) }
            if (String(this.toHighlight) === String(doc.id)) {
                htmlnode.classList.add('highlight')
                setTimeout(_ => {
                    htmlnode.classList.remove('highlight')
                    this.toHighlight = null
                }, 5000)
            }
            if ((Array.isArray(doc['+entries']) && doc['+entries'].length > 0) || doc['+entries'] > 0) {
                htmlnode.classList.add('with-entries')
            }
            const p = []
            if (doc['+entries'] !== undefined && kedDocument.isOpen()) {
                for (let j = 0; j < doc['+entries'].length; j++) {
                    let entry = doc['+entries'][j]
                    p.push(this.renderEntry(`${this.baseUrl.toString()}/`, entry))
                }
            } else if (!kedDocument.isOpen()) {
                for (let child = htmlnode.firstElementChild; child;) {
                    const node = child
                    child = child.nextElementSibling
                    if (node.classList.contains('kentry-container')) {
                        KEDAnim.push(() => {
                            node.parentNode.removeChild(node)
                        })
                    }
                }
            }
            if (p.length > 0) { htmlnode.classList.add('opened-entries') }
            Promise.all(p)
            .then(nodes => {
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i] === null) { continue; }
                    nodes[i].dataset.parentid = doc.id
                    const entryContainer = document.createElement('DIV')
                    entryContainer.id = `container-${nodes[i].id}`
                    entryContainer.appendChild(nodes[i])
                    entryContainer.classList.add('kentry-container')
                    let withDescription = false
                    switch(nodes[i].nodeName) {
                        case 'IMG':
                        case 'VIDEO':
                        case 'A':
                            withDescription = true
                            if (document.getElementById(entryContainer.id)) {
                                const p = document.getElementById(entryContainer.id).parentNode
                                p.removeChild(document.getElementById(entryContainer.id))
                            } 
                            htmlnode.appendChild(entryContainer)
                            entryContainer.classList.add('squared')
                            break;
                        case 'DIV':
                            if (document.getElementById(entryContainer.id)) {
                                const p = document.getElementById(entryContainer.id).parentNode
                                p.removeChild(document.getElementById(entryContainer.id))
                            }
                            let before = htmlnode.firstElementChild
                            while (before && (before.classList.contains('kmetadata') || before.nodeName === 'FORM')) { before = before.nextElementSibling }
                            htmlnode.insertBefore(entryContainer, before)
                            entryContainer.classList.add('flowed')
                            break
                    }
                    const entryDetails = document.createElement('DIV')
                    entryDetails.classList.add('kentry-details')
                    entryDetails.innerHTML = `<span class="name">${(nodes[i].dataset.description || nodes[i].dataset.name) ?? ''}</span>`
                    if (nodes[i].dataset.users) {
                        const users = JSON.parse(nodes[i].dataset.users)
                        for (const userid in users) {
                            entryDetails.innerHTML += `<span class="kuser" data-id="${userid}">@${users[userid]}</span>`
                        }
                    }
                    entryContainer.appendChild(entryDetails)
                    const entryTools = document.createElement('DIV')
                    entryTools.classList.add('kentry-tools')
                    entryTools.innerHTML = `<button class="kui small" data-action="edit-entry"><i class="fas fa-edit"> </i>&nbsp;Éditer</button>`
                        + (withDescription ? '<button class="kui small" data-action="edit-entry-description"><i class="fas fa-sticky-note"> </i>&nbsp;Description</button>' : '')
                        + `<button class="kui danger small" data-action="delete-entry"><i class="fas fa-trash"></i>&nbsp;Supprimer</button>`
                    entryTools.addEventListener('click', this.handleToolsEvents.bind(this))
                    entryContainer.appendChild(entryTools)
                }
                resolve(htmlnode)
            })
            .catch(reason => {
                const str = reason instanceof Error ? reason.message : reason
                this.error(`Impossible d'affcher les entrées, "${str}"`)
            })
        }))
        .then(node => {
            if (node === null) { return }
            const currentNode = document.getElementById(node.id)
            if (currentNode) {
                resolve(currentNode)
                return;
            }
            KEDAnim.push(() => {
                const insCreated = new Date(node.dataset.modified)
                let insert = null
                for (let n = this.container.firstElementChild; n; n = n.nextElementSibling) {
                    if (n.dataset.created === undefined) { continue; }
                    const curCreated = new Date(n.dataset.modified) 
                    if (curCreated.getTime() < insCreated.getTime()) {
                        insert = n
                        break
                    }
                }
                if (insert === null) {
                    insert = document.getElementById('ked-footer')
                }
                this.container.insertBefore(node, insert)
                resolve(node)
            })
            .then(() => {
                resolve(node)
            })
        })

    })
}

KEditor.prototype.render = function (root) {
    if (!root.documents) { console.log(root); return }

    if (this.cwd === '') {
        KEDAnim.push(() => {
            this.headerMenu.innerHTML = `<span data-action="history-home" class="back">
                                        <i class="fas fa-home"></i></span><span class="kmenu-title">${this.title}</span>${this.headerMenu._tools}`
        })
    } else {
        KEDAnim.push(() => {
            this.headerMenu.innerHTML = `<span data-action="history-home" class="back">
                                        <i class="fas fa-home"></i></span><span data-action="history-back" class="back">
                                        <i class="fas fa-arrow-left"></i></span><span class="kmenu-title">${this.title}</span>${this.headerMenu._tools}`
        })
    }

    const elementOnPage = []
    const levels = []
    new Promise ((resolve) => {
        const promises = []
        for (let i = 0; i < root.documents.length; i++) {
            const level = `level-${root.documents[i].abspath.split(',').length}`
            if (levels.indexOf(level) === -1) { levels.push(level) }

            elementOnPage.push(root.documents[i].abspath)
            if (root.documents[i]['+class'].indexOf('entry') !== -1) { continue; }

            promises.push(new Promise((resolve, reject) => {
                KEDDocument.get(root.documents[i].abspath, this.API)
                .then(kedDoc => {
                    let r
                    if (!kedDoc) {
                        return
                    }
                    if (kedDoc.isOpen()) {
                        this.API.getDocument(root.documents[i].abspath)
                        .then(doc => { 
                            return this.renderSingle(doc, level)
                        }).then(node => { 
                            resolve(node)
                        })
                        .catch(reason => {
                            reject(reason)
                        })
                    } else {
                        this.renderSingle(root.documents[i], level)
                        .then(node => {
                            resolve(node)
                        })
                        .catch(reason => {
                            reject(reason)
                        })
                    }
                })
                .catch(reason => {
                    reject(reason)
                })
            }))
        }
        Promise.allSettled(promises).then(_ => resolve())
    })
    .then(_ => {
        let multilevel = false
        if (levels.length > 1) {
            this.container.classList.add('multilevel')
            multilevel = true
        } else {
            this.container.classList.remove('multilevel')
        }
        for (const node of document.getElementsByClassName('document')) {
            if (elementOnPage.indexOf(node.id) === -1) {
                KEDAnim.push(() => {
                    if (node.parentNode) { node.parentNode.removeChild(node) }
                })
            }
        }

        if (multilevel) {
            for (let i = 1; i < 7; i++) {
                if (i === 1) {
                    continue
                }
                const nodes = document.getElementsByClassName(`level-${i}`)
                for (const node of nodes) {
                    const parts = node.id.split(',')
                    let parentNode
                    do {
                        parts.pop()
                        if (parts.length === 0) { break }
                        parentNode = document.getElementById(parts.join(','))
                    } while (!parentNode)
                    if (parentNode !== null) {
                        node.parentNode.removeChild(node)
                        parentNode.parentNode.insertBefore(node, parentNode.nextElementSibling)
                    } else {
                        const p = node.parentNode
                        node.parentNode.removeChild(node)
                        p.appendChild(node)
                    }
                }
            }
        }

        if (this.toHighlight) {
            this.doHighlight(this.toHighlight)
        }

        this.API.getUsers()
        .then(result => {
            if (!result.ok) { return }
            if (!result.data.users) { return }
            let footer = document.getElementById('ked-footer')
            if (!footer) {
                footer = document.createElement('footer')
                footer.id = 'ked-footer'
                this.container.appendChild(footer)
            }
            KEDAnim.push(() => { footer.innerHTML = '' })
            const listed = []
            for (const user of result.data.users) {
                if (listed.indexOf(user.name) !== -1) { continue }
                listed.push(user.name)
                const userDom = document.createElement('DIV')
                userDom.classList.add('kedConnected')
                userDom.innerHTML = `<span class="username">${user.name}</span></span>`
                KEDAnim.push(() => { footer.appendChild(userDom) })
            }
            const reloadButton = document.createElement('BUTTON')
            reloadButton.classList.add('kui')
            reloadButton.id = 'KEDConfiguration'
            reloadButton.innerHTML = 'Recharger'
            const configButton = document.createElement('BUTTON')
            configButton.classList.add('kui')
            configButton.id = 'KEDConfiguration'
            configButton.innerHTML = 'Paramètres'
            const exitButton = document.createElement('BUTTON')
            exitButton.classList.add('kui')
            exitButton.id = 'KEDLogout'
            exitButton.innerHTML = 'Se déconnecter'
            KEDAnim.push(() => {
                footer.appendChild(exitButton)
                footer.appendChild(configButton) 
                footer.appendChild(reloadButton)
            })
            exitButton.addEventListener('click', () => {
                this.authStop()
                window.location.reload()
            })
            reloadButton.addEventListener('click', () => {
                window.location.reload()
            })
        })
    })
}