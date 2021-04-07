function KEditor(container, baseUrl) {
    this.container = container
    this.baseUrl = baseUrl
    this.cwd = ''

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

KEditor.prototype.renderEntry = function (path, entry) {
    return new Promise ((resolve, reject) => {
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
                resolve(htmlnode)
                return
            case 'image':
                htmlnode = document.createElement('IMG')
                htmlnode.src = this.buildPath(path, entry.id)
                htmlnode.classList.add('kimage')
                resolve(htmlnode)
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
                                x.innerHTML = content
                                htmlnode = document.createElement('DIV')
                                htmlnode.innerHTML = x.getElementsByTagName('BODY')[0].innerHTML
                                htmlnode.classList.add('htmltext')
                                resolve(htmlnode)
                                return
                            case 'x-quill-delta':
                                const tmpContainer = document.createElement('DIV')
                                const quill = new Quill(tmpContainer)
                                quill.setContents(JSON.parse(content))
                                htmlnode = document.createElement('DIV')
                                htmlnode.innerHTML = quill.root.innerHTML
                                htmlnode.classList.add('quilltext')
                                resolve(htmlnode)
                                return
                            default:
                                htmlnode = document.createElement('DIV')
                                htmlnode.innerHTML = content
                                htmlnode.classList.add('plaintext')
                                resolve(htmlnode)
                                return
                        }
                    })
                    .catch(_ => resolve(null))
                })
                .catch(_ => resolve(null))
                return
            default: 
                htmlnode = document.createElement('A')
                htmlnode.classList.add('klink')
                htmlnode.href = this.buildPath(path, entry.id)
                let oname = entry.application?.find(value => value.startsWith('ked:name='))
                if (oname) { oname = oname.split('=')[1] }
                htmlnode.innerHTML = `<span class="name">${oname ? oname : ''}</span>`
                resolve(htmlnode)
                return
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
    }
}

KEditor.prototype.uploadFileInteract = function (docNode) {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = 'multiple'
    input.addEventListener('change', (event) => { this.uploadFile(docNode, event) })
    input.click()
}

KEditor.prototype.uploadFile = function (docNode, event) {
    event.preventDefault()
    const files = event.target.files
    let allTransfers = []
    for (let i = 0; i < files.length; i++) {
        allTransfers.push(new Promise ((resolve, reject) => {
            const formData = new FormData()
            formData.append('operation', 'add-entry')
            formData.append('file', files[i])
            formData.append('_filename', files[i].name)
            formData.append('path', this.buildPath(this.cwd, docNode.dataset.pathid))
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
        const quill = new Quill(quillNode.firstElementChild, {
            theme: 'snow',
            modules: {
                toolbar: true
            }
        })
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

KEditor.prototype.render = function (root) {
    if (!root.documents) { console.log(root); return }

    (new Promise((resolve, reject) => {
        if (!this.clearOnRender) {
            if (this.container.firstChild && this.container.firstChild.classList.contains('kmenu')) {
                resolve();
                return
            }
        }
        const menu = document.createElement('DIV')
        menu.classList.add('kmenu')
        menu.innerHTML = `
            <span class="kemu-item" data-action="add-doc"><i class="fas fa-passport"></i></span>
        `
        menu.addEventListener('click', this.menuEvents.bind(this))
        window.requestAnimationFrame(_ => {
            if (this.clearOnRender) { this.container.innerHTML = '' }
            this.clearOnRender = false
            this.container.appendChild(menu)
            resolve()
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

                        switch (doc.class) {
                            case 'document':
                                let date = new Date(doc.created)
                                htmlnode = document.createElement('DIV')
                                htmlnode.innerHTML = `<div class="kmetadata ${doc['+childs'] > 0 ? 'childs' : ''}">
                                    ${new Intl.DateTimeFormat(navigator.language).format(date)} ${doc.name}
                                    <div class="ksubmenu">
                                    <span data-action="add-text"><i class="fas fa-file-alt"></i><span>
                                    <span data-action="upload-file"><i class="fas fa-cloud-upload-alt"></i><span>
                                    <span data-action="add-subdocument"><i class="fas fa-passport"></i><span>
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
                                        switch(nodes[i].nodeName) {
                                            case 'IMG':
                                            case 'VIDEO':
                                            case 'A':
                                                htmlnode.appendChild(nodes[i])
                                                break;
                                            case 'DIV':
                                                htmlnode.insertBefore(nodes[i], htmlnode.firstChild.nextElementSibling)
                                                break

                                        }
                                    }
                                    resolve(htmlnode)
                                })
                                break
                        }
                    })).then(node => {    
                        if (node === null) { return }
                        window.requestAnimationFrame(() => {
                            const insCreated = new Date(node.dataset.created)
                            let insert = null
                            let replace = false
                            for (let n = this.container.firstElementChild; n; n = n.nextElementSibling) {
                                if (n.dataset.created === undefined) { continue; }
                                if (n.dataset.pathid === node.dataset.pathid) {
                                    insert = n;
                                    replace = true
                                    break;
                                }
                                const curCreated = new Date(n.dataset.created) 
                                if (curCreated.getTime() < insCreated.getTime()) {
                                    insert = n
                                }
                            }
                        
                            if (replace) {
                                this.container.replaceChild(node, insert)
                            } else {
                                this.container.insertBefore(node, insert)
                            }
                            resolve()
                        })
                    })
                })
            }
            chain = chain.then(nextDoc(root.documents[i]))
        }
    })
}
