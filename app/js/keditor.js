function KEditor(container, baseUrl) {
    this.container = container
    this.baseUrl = baseUrl
    this.cwd = ''

    this.container.addEventListener('click', this.interact.bind(this))
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
        fetch(url, {'method': 'POST', body: JSON.stringify(content)})
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
    while (node && !node.dataset.pathid) {
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

KEditor.prototype.render = function (root) {
    if (!root.documents) { console.log(root); return }

    (new Promise((resolve, reject) => {
        window.requestAnimationFrame(_ => {
            this.container.innerHTML = ''
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
                                    ${doc['+childs'] > 0 ? '<img clas="kicon" src="../images/next.png" />' : ''}
                                    </div>`
                                htmlnode.dataset.pathid = doc.id
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
                            this.container.appendChild(node)
                            resolve()
                        })
                    })
                })
            }

            chain = chain.then(nextDoc(root.documents[i]))
        }
    })
}
