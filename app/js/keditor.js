function KEditor(container, baseUrl) {
    this.API = new KEDApi(baseUrl)
    this.localLocked = new Map()
    this.container = container
    this.baseUrl = baseUrl
    this.cwd = ''

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
        else { this.setPath(event.state.path) }
        this.clear()
        this.ls()
    })
    if (!window.location?.hash?.startsWith('#menshen-')) {
        this.cwd = window.location.hash.substring(1)
    }

    /* client id is for each browser */
    this.clientid = localStorage.getItem('ked-client-id')
    if (!this.clientid) {
        crypto.subtle.digest(
            {name: 'SHA-256'},
            new TextEncoder().encode(`${navigator.userAgent}-${navigator.platform}-${navigator.vendor}-${new Date().toISOString()}`)
        ).then(hash => {
            this.clientid = KEDUtils.base64EncodeArrayBuffer(hash)
            localStorage.setItem('ked-client-id', this.clientid)
        })
    }

    this.authNext()
}

KEditor.prototype.setupPage = function () {
    this.headerMenu = document.createElement('DIV')
    this.headerMenu.classList.add('kmenu')
    this.headerMenu._tools = '<div><div class="tools"><span data-action="add-document"><i class="fas fa-folder-plus"></i> Nouveau document</span></div>' +
        '<div class="search"><form name="search"><input type="text" name="search" value=""/> <button class="kui" type="submit">Rechercher</button></form></div></div>'
    this.headerMenu.addEventListener('click', this.menuEvents.bind(this))
    this.headerMenu.addEventListener('submit', this.menuFormSubmit.bind(this))
    this.container.appendChild(this.headerMenu)
    this.container.classList.add('keditorRoot')
}

KEditor.prototype.sseSetup = function() {
    const cuEvent = (event) => {
        const data = JSON.parse(event.data)
        const element = document.querySelector(`div[data-pathid="${data.id}"]`)
        if (element) {
            this.refreshDocument(element.id)
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

KEditor.prototype.authForm = function () {
    const form = document.createElement('FORM')
    form.innerHTML = `<div><label for="username">Nom d'utilisateur : <input type="text" name="username" value=""></label><br>
        <label for="keyfile">Clé privée : <input type="file" name="keyfile"></label><br>
        <button type="submit">Authentifier</button></div>`
    document.body.appendChild(form)
    form.addEventListener('submit', event => {
        event.preventDefault()
        const data = new FormData(form)
        
        if (document.location.hash.startsWith('#menshen-')) {
            const key = MenshenEncoding.base64Decode(document.location.hash.substring(9).replaceAll('-', '+').replaceAll('_', '/').replaceAll('.', '='))
            this.API.importAuth(data.get('username'), key)
            .then(() => {
                this.authNext()
            })
        } else {
            const file = data.get('keyfile')
            if (file) {
                reader = new FileReader()
                reader.addEventListener('load', event => {
                    this.API.importAuth(data.get('username'), event.target.result)
                    .then(() => {
                        this.authNext()
                    })
                })
                reader.readAsArrayBuffer(file)
                return
            }
        }
        
    })
}

KEditor.prototype.authNext = function () {
    this.API.init()
    .then(inited => {
        if (inited) {
            return this.API.getUser()
        }
        return {ok: false}
    })
    .then(result => {
        if (!result.ok) {
            this.authForm()
            return
        }
        this.User = result.data
        this.setupPage()
        this.sseSetup()
        this.replaceState()
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
    if (typeof data === 'string') {
        alert(data)
    }
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
            return this.render(result.data)
        })
        .then(_ => resolve())
        .catch(reason => reject(reason))
    })
}

KEditor.prototype.selectedTag = function (event) {
    const tags = []
    for(const tag of this.tags) {
        if (tag[1].state) {
            tags.push(tag[1].tag)
        }
    }
    if (tags.length === 0) {
        return this.ls()
    }
    
    this.API.searchByTags(tags)
    .then(result => {
        if (!result.ok) { this.error(result.data); return}
        return this.render(result.data)
    })
}


KEditor.prototype.pushState = function (path) {
    path = path || this.cwd
    const url = `${String(window.location).split('#')[0]}${this.cwd === '' ? '' : '#'}${path}`
    if (history.state.url === url) {
        history.replaceState({path}, 'KED', url)
        return;
    }
    history.pushState({path}, 'KED', url)
}

KEditor.prototype.replaceState = function () {
    const url = `${String(window.location).split('#')[0]}${this.cwd === '' ? '' : '#'}${this.cwd}`
    history.replaceState({path: this.cwd}, 'KED', url)
}

KEditor.prototype.setPath = function (path) {
    this.cwd = path
}

KEditor.prototype.cd = function (abspath) {
    this.cwd = abspath
    this.pushState()
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
            window.history.pushState({path: this.cwd}, '')
            this.ls()
            break
    }
}

KEditor.prototype.buildPath = function (comp0, comp1) {
    if (comp0 === '') { return comp1 }
    if (comp1 === '') { return comp0 }
    if (comp0 !== ',') { return `${comp0},${comp1}`}
}

KEditor.prototype.edit = {
    quills: function (contentNode, docNode) {
        if (contentNode.dataset.edition) {
            const quill = this.editors.get(contentNode.dataset.entryid)
            this.uploadText(contentNode, JSON.stringify(quill.getContents()), 'text/x-quill-delta')
            this.editors.delete(contentNode.dataset.entryid)
            delete quill
            delete contentNode.dataset.edition
            KEDDocument.get(docNode.id)
            .then(doc => {
                if (doc) { doc.unlock(this) }
            })
            return;
        }
        KEDDocument.get(docNode.id)
        .then(doc => {
            if (doc) { doc.lock(this) }
            contentNode.innerHTML = '<div></div>'
            contentNode.dataset.edition = '1'
            let content = this.data.get(contentNode.dataset.entryid)
            const quill = new Quill(contentNode.firstElementChild, this.quillOpts)
            quill.setContents(content)
            this.editors.set(contentNode.dataset.entryid, quill)
        })
    },
    text: function (contentNode) {
        if (contentNode.dataset.edition) {
            this.uploadText(contentNode, contentNode.firstElementChild.value, 'text/plain')
            delete contentNode.dataset.edition
            KEDDocument.get(docNode.id)
            .then(doc => {
                if (doc) { doc.unlock(this) }
            })
            return;
        }
        KEDDocument.get(docNode.id)
        .then(doc => {
            if (doc) { doc.lock(this) }
            contentNode.dataset.edition = '1'
            let content = this.data.get(contentNode.dataset.entryid)
            contentNode.innerHTML = '<textarea style="width: calc(100% - 8px); height: 380px"></textarea>'
            contentNode.firstElementChild.value = content
        })
    },
    file: function (contentNode) {
        this.uploadFileInteract(contentNode)
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
        switch(subtype[0]) {
            case 'video':
                htmlnode = document.createElement('VIDEO')
                htmlnode.src =`${path}/${entry.abspath}?mod=${entry.modified}`
                htmlnode.classList.add('kvideo')
                htmlnode.setAttribute('width', '200px')
                htmlnode.setAttribute('height', '200px')
                htmlnode.setAttribute('controls', '')
                htmlnode.dataset.edit = 'file'
                subresolve(htmlnode)
                return
            case 'image':
                htmlnode = document.createElement('A')
                htmlnode.href = `${path}/${entry.abspath}?mod=${entry.modified}`
                htmlnode.target = '_blank'
                htmlnode.style.backgroundImage = `url('${path}/${entry.abspath}!browser?mod=${entry.modified}')`
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
                        console.log(subtype)
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
                        htmlnode.href = `${path}/${entry.abspath}?mod=${entry.modified}`
                        htmlnode.innerHTML = `<span class="name">${EntryName}</span>`
                        htmlnode.dataset.edit = 'file'
                        subresolve(htmlnode)
                        return
                    case 'application/pdf':
                        htmlnode = document.createElement('A')
                        htmlnode.href = `${path}/${entry.abspath}?mod=${entry.modified}`
                        htmlnode.target = '_blank'
                        htmlnode.style.backgroundImage = `url('${path}/${entry.abspath}!browser?mod=${entry.modified}')`
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
                this.refreshDocument(docNode.id)
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
            console.log(doc)
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
                })
            }))
        }
    }

    Promise.all(allTransfers)
    .then(_ => {
        this.ls()
    })
}

KEditor.prototype.menuFormSubmit = function (event) {
    event.preventDefault()
    const formData = new FormData(event.target)
    const searchTerm = formData.get('search')
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
        case 'history-back': history.back(); break
        case 'add-document':  this.addDocumentInteract(this.cwd); break

    }
}

KEditor.prototype.docMustOpen = function (docNode) {

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
        })
        form.innerHTML = `<div class="kform-inline"><input type="text" placeholder="Tag" name="tag" autocomplete="off"></input>
            '<button type="submit">Ajouter</button><button type="reset">Annuler</button></div>
            <div class="ktags"></div>`
        form.firstElementChild.addEventListener('keyup', event => {
            if (event.target.value.length <= 0) { return; }
            this.API.searchTags(event.target.value, KED?.tags?.searchMaxSize)
            .then(response => {
                if (!response.ok) { return; }
                if (!response.data.tags) { return; }
                if (response.data.tags.length <= 0) { return; }
                let existing = form.lastElementChild.firstElementChild
                for (const tag of response.data.tags) {
                    const div = existing || document.createElement('DIV')
                    if (!existing) {
                        div.addEventListener('click', event => {
                            form.parentNode.removeChild(form)
                            resolve([event.target.dataset.tag, false])
                            return;
                        })
                    }
                    div.classList.add('ktag')
                    div.dataset.tag = tag
                    div.innerHTML = `<i class="fas fa-hashtag"></i>${tag}`
                    if (!existing) { form.lastElementChild.appendChild(div) }
                    if (existing) { existing = existing.nextElementSibling }
                }
                if (existing) {
                    let next
                    while (existing) {
                        next = existing.nextElementSibling
                        existing.parentNode.removeChild(existing)
                        existing = next
                    }
                }
            })
        })
        docNode.insertBefore(form, docNode.getElementsByClassName('kmetadata')[0].nextElementSibling)
    })
    .then (([tag, create]) => {
        if (create) {
            this.createTag(tag)
            .then(result => {
                this.addDocumentTag(docNode.id, result.data.id)
            })
        } else {
            this.addDocumentTag(docNode.id, tag)
        }
    })
}

KEditor.prototype.addDocumentTag = function (path, tag) {
    return new Promise((resolve, reject) => {
        if (name === null) { resolve(null); return; }
        const operation = {
            operation: 'add-document-tag',
            path,
            tag
        }
        this.fetch('', operation).then(result => {
            this.clear()
            this.ls()
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
        formData.append('path', this.buildPath(this.cwd, this.buildPath(docNode.dataset.parentid, docNode.dataset.entryid)))
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
            })
        }))
    }

    Promise.all(allTransfers)
    .then(_ => {
        this.refreshDocument(docNode.id)
    })
}

KEditor.prototype.uploadText = function (node, content, type = 'text/plain') {
    const op = node.dataset.entryid ? 'update-entry' : 'add-entry'
    const path = op === 'update-entry' ? this.buildPath(this.cwd, this.buildPath(node.dataset.parentid, node.dataset.entryid)) :  this.buildPath(this.cwd, node.dataset.pathid)
    const formData = new FormData()
    const name = `${new Date().toISOString()}`
    formData.append('operation', op)
    formData.append('path', path)
    formData.append('file', new File([content], name, {type: `${type};charset=utf-8`}))
    formData.append('_filename', name)
    this.fetch('', formData)
    .then(_ => {this.ls()})
}

KEditor.prototype.addTextInteract = function (docNode) {
    const quillNode = document.createElement('div')
    quillNode.innerHTML = `<div></div><button>Sauver</button>`
    
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
            .then(_ => { this.refreshDocument(docNode.id) })
        })
    })
}

KEditor.prototype.clear = function () {
    this.clearOnRender = true
}

KEditor.prototype.handleToolsEvents = function (event) {
    event.stopPropagation()
    let kcontainerNode = event.target

    while (kcontainerNode && !kcontainerNode.classList.contains('kentry-container')) { kcontainerNode = kcontainerNode.parentNode }
    if (!kcontainerNode) { return }

    let ktoolsNode = event.target
    while (ktoolsNode && !ktoolsNode.dataset?.action) { ktoolsNode = ktoolsNode.parentNode}
    if (!ktoolsNode) { return }

    let docNode = kcontainerNode
    while (docNode && !docNode.classList.contains('document')) {
        docNode = docNode.parentNode
    }

    switch(ktoolsNode.dataset.action) {
        case 'delete-entry':
            this.deleteEntryInteract(docNode, kcontainerNode.firstElementChild)
            break;
        case 'edit-entry':
            if (!kcontainerNode.firstElementChild.dataset?.edit) { return }
            if (!this.edit[kcontainerNode.firstElementChild.dataset.edit]) { return }
            this.edit[kcontainerNode.firstElementChild.dataset.edit](kcontainerNode.firstElementChild, docNode)
            break;
        case 'to-task':
            this.convertToTaskInteract(kcontainerNode.firstElementChild)
            break;
        case 'to-not-task':
            this.convertToNotTaskInteract(kcontainerNode.firstElementChild)
            break;
    }
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

            htmlnode = kedDocument.getDomNode()
            for (const tag of doc.tags) {
                let ktag = this.tags.get(tag)
                if (!ktag) {
                    ktag = new KTag(tag)
                    ktag.addEventListener('change', this.selectedTag.bind(this))
                    this.tags.set(tag, ktag)
                }
                htmlnode.lastElementChild.lastElementChild.insertBefore(ktag.html(), htmlnode.lastElementChild.lastElementChild.firstElementChild)
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
                htmlnode.addEventListener('drop', this.dropEntry.bind(this))
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
                            htmlnode.insertBefore(entryContainer, htmlnode.firstChild.nextElementSibling)
                            entryContainer.classList.add('flowed')
                            break
                    }
                    const entryTools = document.createElement('DIV')
                    entryTools.classList.add('kentry-tools')
                    entryTools.innerHTML = `<span data-action="edit-entry"><i class="fas fa-edit"></i></span>
                        ${nodes[i].dataset.task ? 
                            '<span data-action="to-not-task" class="fa-stack"><i class="fas fa-tasks fa-stack-1x"></i><i class="fas fa-slash fa-stack-1x"></i></span>' 
                            : '<span data-action="to-task"><i class="fas fa-tasks"></i></span>'}
                            <span data-action="delete-entry"><i class="fas fa-trash"></i></span>`
                        + `<span class="name">${nodes[i].dataset.name}</span>`
                    entryTools.addEventListener('click', this.handleToolsEvents.bind(this))
                    entryContainer.appendChild(entryTools)
                }
                resolve(htmlnode)
            })
        }))
        .then(node => {
            if (node === null) { return }
            const currentNode = document.getElementById(node.id)
            if (currentNode) {
                KEDAnim.push(() => {
                    if (currentNode.parentNode) { currentNode.parentNode.replaceChild(node, currentNode) }
                })
                .then(() => {
                    resolve(node)
                })
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
            this.headerMenu.innerHTML = `<span class="kmenu-title">${KED.title ?? ''}</span>${this.headerMenu._tools}`
            document.title = `[ked] ${KED.title ?? ''}`
        })
    } else {
        KEDAnim.push(() => {
            this.headerMenu.innerHTML = `<span data-action="history-back" class="back"><i class="fas fa-arrow-left"></i></span><span class="kmenu-title"></span>${this.headerMenu._tools}`
        })
        .then (_ => {
            return this.getInfo(this.cwd)
        })
        .then(info => {
            KEDAnim.push(() => {
                this.headerMenu.getElementsByClassName('kmenu-title')[0].innerHTML = info.name
                document.title = `[ked] ${info.name}`
            })
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
    })
}

KEditor.prototype.lock = function (idOrDoc) {
    const operation = {
        operation: 'lock',
        clientid: this.clientid,
        anyid: idOrDoc instanceof KEDDocument ? idOrDoc.getId() : idOrDoc    
    }
    return this.fetch('', operation)
}

KEditor.prototype.unlock = function (idOrDoc) {
    const operation = {
        operation: 'unlock',
        clientid: this.clientid,
        anyid: idOrDoc instanceof KEDDocument ? idOrDoc.getId() : idOrDoc    
    }
    return this.fetch('', operation)
}
