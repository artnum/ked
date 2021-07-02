function KEditor(container, baseUrl) {
    this.API = new KEDApi(baseUrl)
    this.localLocked = new Map()
    this.container = container
    this.baseUrl = baseUrl
    this.cwd = ''
    this.previousPath = []

    this.title = KED.title ?? 'Sans titre'
    this.pushState('path', '', this.title)

    this.tags = new Map()
    this.LockedNotFound = new Map()
    this.quillOpts = {
        theme: 'snow',
        modules: {
            toolbar: [
                ['bold', 'italic', 'underline', 'strike'],        // toggled buttons
              
                [{ 'header': 1 }, { 'header': 2 }],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }],
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
    if (!window.location?.hash?.startsWith('#menshen-')) {
        this.cwd = window.location.hash.substring(1)
    }
    window.addEventListener('hashchange', event => {
        this.authStart()
    })

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
        })
    })
    tagOverlay.appendChild(closeButton)
    KEDAnim.push(() => { document.body.appendChild(tagOverlay)})
}

KEditor.prototype.setupPage = function () {
    this.updateActiveTags()
    setInterval(this.updateActiveTags.bind(this), 60000)
    this.headerMenu = document.createElement('DIV')
    this.headerMenu.classList.add('kmenu')
    this.headerMenu._tools = '<div class="ktool"><div class="tools"><button class="kui" data-action="add-document"><i class="fas fa-folder-plus"></i> Nouveau document</button></div>' +
        '<div class="tools"><button class="kui" data-action="show-tags"><i class="fas fa-tags"> </i>&nbsp;Liste des tags</button></div>' +
        '<div class="search"><form name="search"><input type="text" name="search" value=""/> <button class="kui" type="submit">Rechercher</button></form></div></div>'
    this.headerMenu.addEventListener('click', this.menuEvents.bind(this))
    this.headerMenu.addEventListener('submit', this.menuFormSubmit.bind(this))
    this.container.appendChild(this.headerMenu)
    this.container.classList.add('keditorRoot')
}

KEditor.prototype.sseSetup = function() {
    const cuEvent = (event) => {
        try {
            const data = JSON.parse(event.data)
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
        this.sse.addEventListener('create', event => cuEvent(event))
        this.sse.addEventListener('update', event => cuEvent(event))        
        this.sse.addEventListener('lock', event => this.lockUnlock(event))        
        this.sse.addEventListener('unlock', event => this.lockUnlock(event))        
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
                        reader.addEventListener('load', event => {
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

KEditor.prototype.lockUnlock = function(event) {
    try {
        const lock = JSON.parse(event.data)
        if (lock.clientid === this.clientid) { return }
        const kedDoc = KEDDocument.search(lock.id)
    
        switch(event.type) {
            case 'lock': 
                if (kedDoc) {
                    kedDoc.receiveLock(lock.clientid);
                } else {
                    this.LockedNotFound.set(lock.id, lock.clientid)
                }
                break
            case 'unlock':
                this.LockedNotFound.delete(lock.id)
                if (kedDoc) {
                    kedDoc.receiveUnlock(lock.clientid);
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

KEditor.prototype.getDocument = function (docPath) {
    return new Promise((resolve, reject) => {
        this.API.getDocument(docPath)
        .then(result => {
            if (!result.ok) { resolve(null); return }
            resolve(result.data)
        })
    })
}

KEditor.prototype.refreshDocument = function (docPath) {
    return new Promise((resolve, reject) => {
        this.getDocument(docPath)
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
                this.getInfo(cwd)
                .then(info => {
                    this.setTitle(info.name)
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
        path = content || this.cwd
        url = `${String(window.location).split('#')[0]}${this.cwd === '' ? '' : '#'}${path}`
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
    const url = `${String(window.location).split('#')[0]}${this.cwd === '' ? '' : '#'}${this.cwd}`
    history.replaceState({path: this.cwd}, 'KED', url)
}

KEditor.prototype.setPath = function (path) {
    this.cwd = path
}

KEditor.prototype.cd = function (abspath) {
    if (!this.previousPath) {
        this.previousPath = []
    }
    this.previousPath.push(this.cwd)
    this.cwd = abspath
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
            window.history.pushState({type: 'path', content: this.cwd}, '')
            this.ls()
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
            if (entry['+class'].indexOf('task') !== -1) {
                htmlnode.dataset.task = '1'
            }
            htmlnode.classList.add('content')
            htmlnode.dataset.name = EntryName
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

KEditor.prototype.createTag = function (name = null, related = []) {
    return new Promise((resolve, reject) => {
        if (name === null) { resolve(null); return; }
        const operation = {
            operation: 'create-tag',
            name,
            related
        }
        this.fetch('', operation).then(result => resolve(result))
    })
}

KEditor.prototype.addDocument = function (title = null, path = null) {
    const operation = {
        operation: 'create-document',
        name: title ? title : 'Sans titre',
        path: path ? path : this.cwd
    }
    this.fetch('', operation)
    .then(result => {
        if (!result.ok) { return }
        return KEDDocument.get(result.data.id, this)
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
    const itemQty = files.items.length
    getDoc
    .then(doc => {
        doc.uploadStart(itemQty)
    })
    let allTransfers = []
    for (let i = 0; i < files.items.length; i++) {
        if (files.items[i].kind === 'file') {
            allTransfers.push(new Promise ((resolve, reject) => {
                const formData = new FormData()
                const file = files.items[i].getAsFile()
                formData.append('operation', 'add-entry')
                formData.append('file', file)
                formData.append('_filename', file.name)
                formData.append('path', this.buildPath(this.cwd, docNode.dataset.pathid))
                this.fetch('', formData)
                .then(_ => {
                    resolve()
                    getDoc
                    .then(doc => {
                        doc.uploadNext()
                    })
                })
            }))
        }
    }

    Promise.all(allTransfers)
    .then(_ => {
        this.refreshDocument(docNode.id)
        getDoc
        .then(doc => {
            doc.uploadEnd()
        })
    })
}

KEditor.prototype.menuFormSubmit = function (event) {
    event.preventDefault()
    const formData = new FormData(event.target)
    this.search(formData)
}

KEditor.prototype.search = function (formData) {
    this.pushState('search', this.formData2Json(formData))
    this.previousPath.push(this.cwd)
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
        case 'history-back': this.cwd = this.previousPath.pop(); this.resetTag(); this.ls(); break
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
        case 'open-document': this.cd(docNode.id); this.ls(); break
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
                            KEDAnim.push(() => { form.parentNode.removeChild(form) })
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
        KEDAnim.push(() => { docNode.insertBefore(form, docNode.getElementsByClassName('kmetadata')[0].nextElementSibling) })
        .then(() => {
            form.querySelector('input[type="text"]').focus()
        })
    })
    .then (([tag, create]) => {
        return new Promise(resolve => {
            if (!tag) { resolve(null); return }
            if (create) {
                this.createTag(tag)
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
        this.addDocument(title, path); 
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

KEditor.prototype.getInfo = function (path) {
    return new Promise((resolve, reject) => {
        const formData = new FormData()
        formData.append('operation', 'get-info');
        formData.append('path', path)
        this.fetch('', formData)
        .then(response => {
            if (!response.ok) { resolve(null) }
            resolve(response.data)
        })
        .catch(reason => reject(reason))
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
    getDoc
    .then(doc => {
        doc.uploadStart(files.length)
    })
    let allTransfers = []
    for (let i = 0; i < files.length; i++) {
        allTransfers.push(new Promise ((resolve, reject) => {
            const formData = new FormData()
            formData.append('operation', op)
            formData.append('_filename', files[i].name)
            formData.append('path', path)
            formData.append('file', files[i])
            this.fetch('', formData)
            .then(_ => {
                resolve()
                getDoc
                .then(doc => {
                    doc.uploadNext()
                })
            })
        }))
    }

    Promise.all(allTransfers)
    .then(_ => {
        getDoc
        .then(doc => {
            doc.uploadEnd()
        })
        this.refreshDocument(docNode.id)
    })
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
                            } else {
                                doc.unlock(this.API)
                                KEDAnim.push(() => {
                                    ktoolsNode.innerHTML = '<i class="fas fa-edit"> </i>&nbsp;Éditer' 
                                    if (ktoolsNode.nextElementSibling.dataset.action === 'stop-edit') {
                                        ktoolsNode.parentNode.removeChild(ktoolsNode.nextElementSibling)
                                    }
                                })
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
        this.getInfo(kedDocument.getId())
        .then(doc => {
            kedDocument.close()
            this.renderSingle(doc)
        })
    } else {
        kedDocument.open()
        this.getDocument(kedDocument.getId())
        .then(doc => {
            this.renderSingle(doc)
        })
    }
}

KEditor.prototype.renderSingle = function (doc) {
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
            const kedDocument = new KEDDocument(doc)
            if (this.LockedNotFound.has(kedDocument.getRelativeId())) {
                kedDocument.receiveLock(this.LockedNotFound.get(kedDocument.getRelativeId()))
                this.LockedNotFound.delete(kedDocument.getRelativeId())
            }

            kedDocument.addEventListener('delete-document', (event) => { this.deleteDocumentInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('open-document', (event) => { this.cd(event.detail.target.getId()); this.ls(); })
            kedDocument.addEventListener('toggle-entries', (event) => { this.toggleEntriesDisplay(event.detail.target) })
            kedDocument.addEventListener('add-text', (event) => { this.docMustOpen(event.detail.target.getId()); this.addTextInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('upload-file', (event) => { this.docMustOpen(event.detail.target.getId()); this.uploadFileInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('add-tag', (event) => { this.addTagInteract(event.detail.target.getDomNode()); })
            kedDocument.addEventListener('drop', this.dropEntry.bind(this))


            htmlnode = kedDocument.getDomNode()
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
            if (this.toHighlight === doc.id) {
                htmlnode.classList.add('highlight')
                setTimeout(_ => {
                    htmlnode.classList.remove('highlight')
                    this.toHighlight = null
                }, 5000)
            }
            if (!refresh) {
                htmlnode.addEventListener('dragover', (event) => { event.preventDefault() }) 
                htmlnode.addEventListener('dragenter', (event) => { 
                    let node = event.target
                    while (node && ! node.dataset?.pathid) { node = node.parentNode }
                    if (node.dataset.kedDrageCounter === undefined) {
                        node.dataset.kedDrageCounter = 0
                    }
                    node.dataset.kedDrageCounter++
                    KEDAnim.push(() => {
                        node.classList.add('highlight')
                    })
                    event.preventDefault() 
                })
                htmlnode.addEventListener('dragleave', (event) => { 
                    let node = event.target
                    while (node && ! node.dataset?.pathid) { node = node.parentNode }
                    node.dataset.kedDrageCounter--
                    KEDAnim.push(() => {
                        if (node.dataset.kedDrageCounter <= 0) {
                            node.classList.remove('highlight')
                        }
                    })
                    event.preventDefault() 
                })
            }
            if ((Array.isArray(doc['+entries']) && doc['+entries'].length >0) || doc['+entries'] > 0) {
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
                    switch(nodes[i].nodeName) {
                        case 'IMG':
                        case 'VIDEO':
                        case 'A':
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
                    const entryTools = document.createElement('DIV')
                    entryTools.classList.add('kentry-tools')
                    entryTools.innerHTML = `<button class="kui small" data-action="edit-entry"><i class="fas fa-edit"> </i>&nbsp;Éditer</button>`
                        +`<button class="kui danger small" data-action="delete-entry"><i class="fas fa-trash"></i>&nbsp;Supprimer</button>`
                        + `<span class="name">${nodes[i].dataset.name}</span>`
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
            this.headerMenu.innerHTML = `<span class="kmenu-title">${this.title}</span>${this.headerMenu._tools}`
        })
    } else {
        KEDAnim.push(() => {
            this.headerMenu.innerHTML = `<span data-action="history-back" class="back"><i class="fas fa-arrow-left"></i></span><span class="kmenu-title">${this.title}</span>${this.headerMenu._tools}`
        })
    }

    const elementOnPage = []
    let chain = Promise.resolve()
    const p = []
    for (let i = 0; i < root.documents.length; i++) {
        elementOnPage.push(root.documents[i].abspath)
        if (root.documents[i]['+class'].indexOf('entry') !== -1) { continue; }
        KEDDocument.get(root.documents[i].abspath, this)
        .then(kedDoc => {
            let r
            if (!kedDoc) {
                r = Promise.resolve()
                chain = chain.then(r)
                return
            }
            if (kedDoc.isOpen()) {
                r = new Promise((resolve, reject) => {
                    this.getDocument(root.documents[i].abspath)
                    .then(doc => { this.renderSingle(doc).then(node => resolve(node)) })
                })
            } else {
                r = this.renderSingle(root.documents[i])
            }
            p.push(r)
            chain = chain.then(r)
        })
    }
    Promise.all(p)
    .then(_ => {
        for (const node of document.getElementsByClassName('document')) {
            if (elementOnPage.indexOf(node.id) === -1) {
                KEDAnim.push(() => {
                    if (node.parentNode) { node.parentNode.removeChild(node) }
                })
            }
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
            const exitButton = document.createElement('BUTTON')
            exitButton.classList.add('kui')
            exitButton.id = 'KEDLogout'
            exitButton.innerHTML = 'Se déconnecter'
            KEDAnim.push(() => { footer.appendChild(exitButton) })
            exitButton.addEventListener('click', () => {
                this.authStop()
                window.location.reload()
            })
        })
    })
}