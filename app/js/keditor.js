function KEditor(container, baseUrl) {
    this.container = container
    this.baseUrl = baseUrl
    this.cwd = ''

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
    window.addEventListener('popstate', (event) => {
        if (event.state === null) { 
            this.cwd = ''
            this.ls()
            return;
         }
        this.cwd = event.state.path
        this.ls()
    })
    this.container.classList.add('keditorRoot')
    this.ls()
}

KEditor.prototype.fetch = function (path, content) {
    return new Promise((resolve, reject) => {
        if (path.length > 0) { path = `/${path}` }
        let url = new URL(`${this.baseUrl.toString()}${path}`)
        console.trace()
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

KEditor.prototype.error = function (data) {
    if (typeof data === 'string') {
        alert(data)
    }
}

KEditor.prototype.ls = function () {
    this.fetch(this.cwd, {operation: 'list-document', format: 'extended'}).then(result =>{
        if (!result.ok) { this.error(result.data); return }
        this.render(result.data)
    })
}

KEditor.prototype.getInfo = function (docId) {
    return new Promise((resolve, reject) => {
    })
}

KEditor.prototype.cd = function (id) {
    if (id === '.') { return }
    if (id === '..') {
        if (this.cwd === '') { return }
        let frags = this.cwd.split(',')
        frags.pop()
        if (frags.length === 0) { this.cwd = ''; return}
        this.cwd = frags.join(',')
    }
    if (this.cwd === '') {
        this.cwd = id
        return
    }
    this.cwd = [this.cwd, id].join(',')
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
            this.cd(node.dataset.pathid)           
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
                htmlnode = document.createElement('IMG')
                htmlnode.src = this.buildPath(path, entry.id)
                htmlnode.classList.add('kimage')
                htmlnode.dataset.edit = 'file'
                subresolve(htmlnode)
                return
            case 'text':
            case 'message':
                fetch(new URL(this.buildPath(path, entry.id)))
                .then(response => {
                    if (!response.ok) { resolve(null); return; }
                    response.text()
                    .then(content => {
                        let type = entry.type
                        subtype = type.split('/', 2)
                        if (subtype[1] === undefined) { resolve(null); return }
                        switch (subtype[1]) {
                            case 'rf822':
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
                        htmlnode.href = this.buildPath(path, entry.id)
                        htmlnode.innerHTML = `<span class="name">${EntryName}</span>`
                        htmlnode.dataset.edit = 'file'
                        subresolve(htmlnode)
                        return
                    case 'application/pdf':
                        htmlnode = document.createElement('A')
                        htmlnode.src = this.buildPath(path, entry.id)
                        htmlnode.style.backgroundImage = `url('${htmlnode.src}?format=preview')`
                        htmlnode.classList.add('klink')
                        htmlnode.dataset.edit = 'file'
                        subresolve(htmlnode)
                        return                       
                }
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
        case 'add-doc': this.addDocument(); break

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
        case 'delete-document': this.deleteDocument(docNode); this.clear(); this.ls(); break;
        case 'add-subdocument':  this.addDocument(null, this.buildPath(this.cwd, docNode.dataset.pathid)); break
        case 'open-document': this.cd(docNode.dataset.pathid); this.clear(); this.ls(); break
        case 'add-text': this.addTextInteract(docNode); break
        case 'upload-file': this.uploadFileInteract(docNode); break
        case 'to-task': this.convertToTaskInteract(docNode); break
        case 'to-not-task': this.convertToNotTaskInteract(docNode); break
        case 'set-task-done': this.updateTask(docNode, [[ 'taskDone', new Date().toISOString() ]]); break
        case 'set-task-undone': this.updateTask(docNode, [[ 'taskDone', '' ]]); break
    }
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

    (new Promise((resolve, reject) => {
        const menu = document.createElement('DIV')
        menu.classList.add('kmenu')
        let p = Promise.resolve()
        if (this.cwd === '') {
            menu.innerHTML = `
                <span class="kemu-item" data-action="add-doc"><i class="fas fa-passport"></i></span>
            `
        } else {
            p = new Promise((resolve, reject) => {
                menu.innerHTML = ''
                resolve()
            })
        }
        p.then(_ => {
            menu.addEventListener('click', this.menuEvents.bind(this))
            window.requestAnimationFrame(_ => {
                if (this.clearOnRender) { this.container.innerHTML = '' }
                this.clearOnRender = false
                if (this.container.firstChild && this.container.firstChild.classList.contains('kmenu')) {
                    this.container.replaceChild(menu, this.container.firstChild)
                } else {
                    this.container.appendChild(menu)
                }
                resolve()
            })
        })
    })).then(_ => {
        let chain = Promise.resolve()
        for (let i = 0; i < root.documents.length; i++) {
            const nextDoc = (doc) => {
                return new Promise((resolve, reject) => {
                    (new Promise((resolve, reject) => {
                        let htmlnode     
                        doc.class = 'document'
                        if (doc['+class'].indexOf('entry') != -1) { doc.class = 'entry' }
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

                        switch (doc.class) {
                            case 'document': 
                                let date = new Date(doc.created)
                                htmlnode = document.createElement('DIV')
                                htmlnode.innerHTML = `<div class="kmetadata ${doc['+childs'] > 0 ? 'childs' : ''}">
                                    ${task.is ? (task.done ? '<i data-action="set-task-undone" class="fas fa-clipboard-check"></i>' : '<i data-action="set-task-done" class="fas fa-clipboard"></i>'): ''}
                                    ${new Intl.DateTimeFormat(navigator.language).format(date)} ${doc.name}
                                    <div class="ksubmenu">
                                    <span data-action="add-text"><i class="fas fa-file-alt"></i></span>
                                    <span data-action="upload-file"><i class="fas fa-cloud-upload-alt"></i><span>
                                    <span data-action="add-subdocument"><i class="fas fa-passport"></i><span>
                                    ${!task.is ? '<span data-action="to-task"><i class="fas fa-tasks"></i></span>' : 
                                        '<span data-action="to-not-task" class="fa-stack"><i class="fas fa-tasks fa-stack-1x"></i><i class="fas fa-slash fa-stack-1x"></i></span>'}
                                    ${doc['+childs'] > 0 ? '<span data-action="open-document"><i class="fas fa-caret-square-right"></i></span>' : ''}
                                    <span data-action="delete-document"><i class="fas fa-trash"></i><span>
                                    </div>
                                    </div>`
                                htmlnode.addEventListener('click', this.submenuEvents.bind(this))
                                htmlnode.dataset.pathid = doc.id
                                htmlnode.dataset.created = doc.created
                                htmlnode.dataset.modified = doc.modified
                                htmlnode.dataset.childs = doc['+childs']
                                htmlnode.classList.add('document')
                                htmlnode.addEventListener('dragover', (event) => { event.preventDefault() })
                                htmlnode.addEventListener('dragenter', (event) => { 
                                    let node = event.target
                                    while (node && ! node.dataset?.pathid) { node = node.parentNode }
                                    if (node.dataset.kedDrageCounter === undefined) {
                                        node.dataset.kedDrageCounter = 0
                                    }
                                    node.dataset.kedDrageCounter++
                                    window.requestAnimationFrame(() => {
                                        node.classList.add('kdropme')
                                    })
                                    event.preventDefault() 
                                })
                                htmlnode.addEventListener('dragleave', (event) => { 
                                    let node = event.target
                                    while (node && ! node.dataset?.pathid) { node = node.parentNode }
                                    node.dataset.kedDrageCounter--
                                    window.requestAnimationFrame(() => {
                                        if (node.dataset.kedDrageCounter <= 0) {
                                            node.classList.remove('kdropme')
                                        }
                                    })
                                    event.preventDefault() 
                                })
                                htmlnode.addEventListener('drop', this.dropEntry.bind(this))

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
                                break
                        }
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
    })
}
