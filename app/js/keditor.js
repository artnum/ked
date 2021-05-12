function KEditor(container, baseUrl) {
    this.container = container
    this.baseUrl = baseUrl
    this.cwd = ''
    this.headerMenu = document.createElement('DIV')
    this.headerMenu.classList.add('kmenu')
    this.headerMenu._tools = '<div class="tools"><span data-action="add-document"><i class="fas fa-folder-plus"></i> Nouveau document</span></div>'
    this.headerMenu.addEventListener('click', this.menuEvents.bind(this))
    this.container.appendChild(this.headerMenu)
    this.container.classList.add('keditorRoot')

    this.tags = new Map()

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
    if (window.location?.hash?.length > 0) {
        this.cwd = window.location.hash.substring(1)
    }
    this.replaceState()
    this.ls()
}

KEditor.prototype.fetch = function (path, content) {
    return new Promise((resolve, reject) => {
        if (path.length > 0) { path = `/${path}` }
        let url = new URL(`${this.baseUrl.toString()}${path}`)
        fetch(url, {'method': 'POST',
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
                resolve(ret)
                return
            }
            response.json()
            .then(result => {
                resolve({ok: true, data: result})
            })
            .catch(reason => resolve({ok: false, data: reason}))
        })
        .catch(reason => resolve({ok: false, data: reason}))
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

KEditor.prototype.ls = function () {
    return new Promise((resolve, reject) => {
        this.fetch(this.cwd, {operation: 'list-document', format: 'extended'})
        .then(result =>{
            if (!result.ok) { this.error(result.data); return }
            return this.render(result.data)
        })
        .then(_ => resolve())
        .catch(reason => reject(reason))
    })
}

KEditor.prototype.selecteTag = function (event) {
    const tags = []
    for(const tag of this.tags) {
        if (tag[1].state) {
            tags.push(tag[1].tag)
        }
    }
    if (tags.length === 0) {
        return this.ls()
    }
    
    this.fetch('', {operation: 'search-by-tags', tags})
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
    quills: function (contentNode) {
        if (contentNode.dataset.edition) {
            const quill = this.editors.get(contentNode.dataset.entryid)
            this.uploadText(contentNode, JSON.stringify(quill.getContents()), 'text/x-quill-delta')
            this.editors.delete(contentNode.dataset.entryid)
            delete quill
            delete contentNode.dataset.edition
            return;
        }
        contentNode.innerHTML = '<div></div>'
        contentNode.dataset.edition = '1'
        let content = this.data.get(contentNode.dataset.entryid)
        const quill = new Quill(contentNode.firstElementChild, this.quillOpts)
        quill.setContents(content)
        this.editors.set(contentNode.dataset.entryid, quill)
    },
    text: function (contentNode) {
        let content = this.data.get(contentNode.dataset.entryid)
        contentNode.innerHTML = '<textarea style="width: calc(100% - 8px); height: 380px"></textarea>'
        contentNode.firstElementChild.value = content
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
                htmlnode.src = this.buildPath(path, entry.id)
                htmlnode.classList.add('kvideo')
                htmlnode.setAttribute('width', '200px')
                htmlnode.setAttribute('height', '200px')
                htmlnode.setAttribute('controls', '')
                htmlnode.dataset.edit = 'file'
                subresolve(htmlnode)
                return
            case 'image':
                htmlnode = document.createElement('A')
                htmlnode.href = this.buildPath(path, entry.id)
                htmlnode.style.backgroundImage = `url('${htmlnode.href}!browser')`
                htmlnode.classList.add('klink')
                htmlnode.dataset.edit = 'file'
                subresolve(htmlnode)
                return
            case 'text':
                fetch(new URL(this.buildPath(path, entry.id)))
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
                                x.innerHTML = contenttitregetElementsByTagName('BODY')[0].innerHTML
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
                        htmlnode.href = this.buildPath(path, entry.id)
                        htmlnode.innerHTML = `<span class="name">${EntryName}</span>`
                        htmlnode.dataset.edit = 'file'
                        subresolve(htmlnode)
                        return
                    case 'application/pdf':
                        htmlnode = document.createElement('A')
                        htmlnode.href = this.buildPath(path, entry.id)
                        htmlnode.style.backgroundImage = `url('${htmlnode.href}!browser')`
                        htmlnode.classList.add('klink')
                        htmlnode.dataset.edit = 'file'
                        subresolve(htmlnode)
                        return                       
                    case 'message/rfc822':
                        fetch(new URL(`${this.buildPath(path, entry.id)}`))
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
    const operation = {
        operation: 'delete',
        path: this.buildPath(this.cwd, docNode.dataset.pathid)
    }
    this.fetch('', operation)
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
        if (result.data.id) {
            this.highlight(result.data.id)
            this.ls()
        }
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

KEditor.prototype.menuEvents = function (event) {
    let actionNode = event.target

    while (actionNode && !actionNode.dataset?.action) { actionNode = actionNode.parentNode }
    if (!actionNode) { return }

    switch(actionNode.dataset.action) {
        case 'history-back': history.back(); break
        case 'add-document':  this.addDocumentInteract(this.cwd); break

    }
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
        case 'add-text': this.addTextInteract(docNode); break
        case 'upload-file': this.uploadFileInteract(docNode); break
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
            const expr = event.target.value
            if (expr === '') { return; }
            const operation = new FormData()
            operation.set('operation', 'search-tags')
            operation.set('expression', expr)
            operation.set('maxsize', 3)
            this.fetch('', operation)
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
    console.log(this.cwd)
    new Promise((resolve, reject) => {
        const formNode = document.createElement('FORM')
        formNode.classList.add('kform-inline')
        formNode.addEventListener('submit', event => {
            event.preventDefault()
            const fdata = new FormData(event.target)
            event.target.parentNode.removeChild(event.target)
            resolve(fdata.get('name'))
        })
        formNode.addEventListener('reset', event => {
            event.target.parentNode.removeChild(event.target)
        })
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
        this.ls()
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
        this.ls()
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
        this.ls()
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
    const files = event.target.files
    const op = node.dataset.entryid ? 'update-entry' : 'add-entry'
    const path = op === 'update-entry' ? this.buildPath(this.cwd, this.buildPath(node.dataset.parentid, node.dataset.entryid)) :  this.buildPath(this.cwd, node.dataset.pathid)
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
        this.ls()
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
    new Promise((resolve, reject) => {
        window.requestAnimationFrame(() => {
          docNode.insertBefore(quillNode, docNode.firstElementChild.nextElementSibling)
          resolve()
        })
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
            .then(_ => {this.ls()})
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

    switch(ktoolsNode.dataset.action) {
        case 'edit-entry':
            if (!kcontainerNode.firstElementChild.dataset?.edit) { return }
            if (!this.edit[kcontainerNode.firstElementChild.dataset.edit]) { return }
            this.edit[kcontainerNode.firstElementChild.dataset.edit](kcontainerNode.firstElementChild)
            break;
        case 'to-task':
            this.convertToTaskInteract(kcontainerNode.firstElementChild)
            break;
        case 'to-not-task':
            this.convertToNotTaskInteract(kcontainerNode.firstElementChild)
            break;
    }
}

KEditor.prototype.render = function (root) {
    if (!root.documents) { console.log(root); return }

    if (this.cwd === '') {
        window.requestAnimationFrame(() => {
            this.headerMenu.innerHTML = `<span class="kmenu-title">${KED.title ?? ''}</span>${this.headerMenu._tools}`
        })
    } else {
        new Promise ((resolve, reject) => {
            window.requestAnimationFrame(() => {
                this.headerMenu.innerHTML = `<span data-action="history-back" class="back"><i class="fas fa-arrow-left"></i></span><span class="kmenu-title"></span>${this.headerMenu._tools}`
                resolve()
            })
        })
        .then (_ => {
            return this.getInfo(this.cwd)
        })
        .then(info => {
            window.requestAnimationFrame(() => {
                this.headerMenu.getElementsByClassName('kmenu-title')[0].innerHTML = info.name
            })
        })
    }
    const documentsAbsPath = []
    let chain = Promise.resolve()
    for (let i = 0; i < root.documents.length; i++) {
        if (root.documents[i]['+class'].indexOf('entry') !== -1) { continue; }
        documentsAbsPath.push(root.documents[i].abspath)
        const nextDoc = (doc) => {
            return new Promise((resolve, reject) => {
                (new Promise((resolve, reject) => {
                    let htmlnode
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
                    let refresh = true
                    htmlnode = document.getElementById(this.buildPath(doc.id, this.cwd))
                    if (!htmlnode) {
                        refresh = false
                        htmlnode = document.createElement('DIV')
                    }
                    htmlnode.innerHTML = `<div class="kmetadata ${doc['+childs'] > 0 ? 'childs' : 'no-child'}">
                        ${task.is ? (task.done ? '<i data-action="set-task-undone" class="fas fa-clipboard-check"></i>' : '<i data-action="set-task-done" class="fas fa-clipboard"></i>'): ''}
                        ${new Intl.DateTimeFormat(navigator.language).format(date)} ${doc.name}
                        <div class="navigation"><span data-action="open-document" class="forward"><i class="fas fa-arrow-right"></i></span></div>
                        <div class="ksubmenu">
                        <span data-action="add-text"><i class="fas fa-file-alt"></i></span>
                        <span data-action="upload-file"><i class="fas fa-cloud-upload-alt"></i></span>
                        ${!task.is ? '<span data-action="to-task"><i class="fas fa-tasks"></i></span>' : 
                            '<span data-action="to-not-task" class="fa-stack"><i class="fas fa-tasks fa-stack-1x"></i><i class="fas fa-slash fa-stack-1x"></i></span>'}
                        <span data-action="delete-document"><i class="fas fa-trash"></i></span>
                        </div>
                        <div class="ktags"><span class="ktags-tools" data-action="add-tag"><i class="fas fa-plus-circle"></i></span></div>
                        </div>`
                    for (const tag of doc.tags) {
                        let ktag = this.tags.get(tag)
                        if (!ktag) {
                            ktag = new KTag(tag)
                            ktag.addEventListener('change', this.selecteTag.bind(this))
                            this.tags.set(tag, ktag)
                        }
                        htmlnode.lastElementChild.lastElementChild.insertBefore(ktag.html(), htmlnode.lastElementChild.lastElementChild.firstElementChild)
                    }
                    if (!refresh) { htmlnode.addEventListener('click', this.submenuEvents.bind(this)) }
                    htmlnode.id = doc.abspath
                    htmlnode.dataset.pathid = doc.id
                    htmlnode.dataset.created = doc.created
                    htmlnode.dataset.modified = doc.modified
                    htmlnode.dataset.childs = doc['+childs']
                    htmlnode.classList.add('document')
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
                            window.requestAnimationFrame(() => {
                                node.classList.add('highlight')
                            })
                            event.preventDefault() 
                        })
                        htmlnode.addEventListener('dragleave', (event) => { 
                            let node = event.target
                            while (node && ! node.dataset?.pathid) { node = node.parentNode }
                            node.dataset.kedDrageCounter--
                            window.requestAnimationFrame(() => {
                                if (node.dataset.kedDrageCounter <= 0) {
                                    node.classList.remove('highlight')
                                }
                            })
                            event.preventDefault() 
                        })
                        htmlnode.addEventListener('drop', this.dropEntry.bind(this))
                    }

                    let p = []
                    for (let j = 0; j < doc['+entries'].length; j++) {
                        let entry = doc['+entries'][j]
                        p.push(this.renderEntry(`${this.baseUrl.toString()}/${this.buildPath(this.cwd, doc.id)}`, entry))
                    }
                    Promise.all(p)
                    .then(nodes => {
                        for (let i = 0; i < nodes.length; i++) {
                            if (nodes[i] === null) { continue; }
                            nodes[i].dataset.parentid = doc.id
                            const entryContainer = document.createElement('DIV')
                            entryContainer.appendChild(nodes[i])
                            entryContainer.classList.add('kentry-container')
                            switch(nodes[i].nodeName) {
                                case 'IMG':
                                case 'VIDEO':
                                case 'A':
                                    htmlnode.appendChild(entryContainer)
                                    entryContainer.classList.add('squared')
                                    break;
                                case 'DIV':
                                    htmlnode.insertBefore(entryContainer, htmlnode.firstChild.nextElementSibling)
                                    entryContainer.classList.add('flowed')
                                    break
                            }
                            const entryTools = document.createElement('DIV')
                            entryTools.classList.add('kentry-tools')
                            entryTools.innerHTML = `<span data-action="edit-entry"><i class="fas fa-edit"></i></span>
                                ${nodes[i].dataset.task ? 
                                    '<span data-action="to-not-task" class="fa-stack"><i class="fas fa-tasks fa-stack-1x"></i><i class="fas fa-slash fa-stack-1x"></i></span>' 
                                    : '<span data-action="to-task"><i class="fas fa-tasks"></i></span>'}`
                                + `<span class="name">${nodes[i].dataset.name}</span>`
                            entryTools.addEventListener('click', this.handleToolsEvents.bind(this))
                            entryContainer.appendChild(entryTools)
                        }
                        resolve(htmlnode)
                    })
                })).then(node => {    
                    if (node === null) { return }
                    window.requestAnimationFrame(() => {
                        const insCreated = new Date(node.dataset.modified)
                        let insert = null
                        for (let n = this.container.firstElementChild; n; n = n.nextElementSibling) {
                            if (n.dataset.created === undefined) { continue; }
                            if (n.dataset.pathid === node.dataset.pathid) {
                                this.container.removeChild(n)
                                continue
                            }
                            const curCreated = new Date(n.dataset.modified) 
                            if (curCreated.getTime() < insCreated.getTime()) {
                                insert = n
                                break
                            }
                        }
                        this.container.insertBefore(node, insert)
                        resolve()
                    })
                })
            })
        }
        chain = chain.then(nextDoc(root.documents[i]))
    }
    const currentDocs = this.container.getElementsByClassName('document')
    for (const currentDoc of currentDocs) {
        if (documentsAbsPath.indexOf(currentDoc.id) === -1) {
            window.requestAnimationFrame(() => {
                currentDoc.parentNode.removeChild(currentDoc)
            })
        }
    }
}
