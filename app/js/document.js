function KEDDocument (doc, api) {
    if (window.KEDDocumentRegistry === undefined) {
        window.KEDDocumentRegistry = new Map()
    }
    const kedDocument = KEDDocument.registered(doc.abspath) || this
    kedDocument.API = api
    if (!kedDocument.EvtTarget) {
        kedDocument.EvtTarget = new EventTarget()
        kedDocument.installedEvents = []
    }

    if (kedDocument.state === undefined) {
        kedDocument.state = {
            open: false,
            highlighted: false,
            locked: false
        }
    }
    this.changes = kedDocument.compare(doc)
    kedDocument.doc = doc
    kedDocument.domNode = kedDocument.getDomNode()
    if (!kedDocument.domNode) {
        kedDocument.domNode = document.createElement('DIV')
        kedDocument.domNode.addEventListener('click', this.handleClickEvent.bind(this))
        KEDAnim.push(() => {
            kedDocument.domNode.classList.add('document')
        })
        kedDocument.domNode.id = kedDocument.doc.abspath
        kedDocument.domNode.dataset.pathid = kedDocument.doc.id
        kedDocument.domNode.dataset.created = kedDocument.doc.created
        kedDocument.domNode.dataset.modified = kedDocument.doc.modified
        kedDocument.domNode.dataset.childs = kedDocument.doc['+childs']
     
        const task = {
            is: kedDocument.doc['+class'].indexOf('task') === -1 ? false : true,
            done: false,
            end: null,
            previous: null
        }
        if (task.is) {
            if (doc['taskDone'] !== undefined) {
                task.done = true
            }
        }
     
        kedDocument.domNode.innerHTML = 
            `<div class="kmetadata ${doc['+childs'] > 0 ? 'childs' : 'no-child'}">` +
            `${task.is ? (task.done ? '<i data-action="set-task-undone" class="fas fa-clipboard-check"></i>' : '<i data-action="set-task-done" class="fas fa-clipboard"></i>'): ''}` +
            `<span id="name-${doc.id}">${doc.name}</span>` +
            `<div class="navigation indicator"><span data-action="open-document" class="forward"><i class="fas fa-arrow-right"></i></span></div>` +
            `<div class="indicator"><span data-action="print-document"><i class="fas fa-print"></i></span></div>` +
            `<div class="has-childs indicator"><span data-action="toggle-entries"><i name="open" class="fas fa-folder"></i></span></div>` +
            `<div class="ksubmenu">` +
            `<button class="kui small" data-action="add-text"><i class="fas fa-file-alt"> </i>&nbsp;Texte</button>` +
            `<button class="kui small" data-action="upload-file"><i class="fas fa-cloud-upload-alt"> </i>&nbsp;Fichier</button>` +
            `<button class="kui small" data-display="next" data-action="archive-document"><i class="fas fa-archive"> </i>&nbsp;Archiver</button>` +
            `<button class="kui small danger" data-display="next" data-action="delete-document"><i class="fas fa-trash"> </i>&nbsp;Supprimer</button>` +
            `<button class="kui verysmall" data-action="display-next"><i class="fas fa-forward"></i></button>` +
            `</div>` +
            `<div class="kusers">${kedDocument.htmlUserList()}</div>` +
            `<div class="kdates">${kedDocument.dates()}</div>` +
            `<div id="tag-${doc.id}" class="ktags">` +
            `</div>` +
            `<div class="ktags-tools" ><span data-action="add-tag"><i class="fas fa-plus-circle"></i>&nbsp;Ajouter tag</span>` +
            `<span data-action="remove-tag"><i class="fas fa-minus-circle"></i>&nbsp;Retirer tag</span></div>` +
            `</div>`

        kedDocument.domNode.querySelector('button[data-action="display-next"]').addEventListener('click', kedDocument.handleNextEvent.bind(kedDocument))
        kedDocument.domNode.firstElementChild.addEventListener('dragenter', kedDocument.handleDragEvent.bind(kedDocument), {capture: true})
        kedDocument.domNode.firstElementChild.addEventListener('dragover', kedDocument.handleDragEvent.bind(kedDocument), {capture: true})
        kedDocument.domNode.firstElementChild.addEventListener('dragleave', kedDocument.handleDragEvent.bind(kedDocument), {capture: true})
        kedDocument.domNode.firstElementChild.addEventListener('drop', kedDocument.handleDropEvent.bind(kedDocument), {capture: true})
    }

    if (doc['+lock']) {
        kedDocument.state.locked = doc['+lock']
    }

    kedDocument.meta() // set metadata
    kedDocument.register()
    kedDocument.applyStates()

    return kedDocument
}

KEDDocument.prototype.dates = function () {
    const created = new Date(this.doc.created)
    const modified = new Date(this.doc.modified)

    return `<span class="created">Créé ${created.toLocaleDateString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}</span>` +
        `<span class="modified">Modifié ${modified.toLocaleDateString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}</span>`
}

KEDDocument.prototype.getTags = function () {
    return this.doc.tags
}

KEDDocument.prototype.htmlUserList = function () {
    if (!this.doc.user) { return '' }
    let userhtml = ''
    for (let userid in this.doc.user) {
        userhtml += `<span class="kuser" data-id="${userid}">@${this.doc.user[userid]}</span>`
    }
    return userhtml
}

KEDDocument.prototype.handleNextEvent = function (event) {
    if (!event.target.dataset.action && !event.target.parentNode?.dataset?.action) { return }
    const node = event.target.dataset.action ? event.target : event.target.parentNode

    const buttons = node.parentNode.querySelectorAll('button')
    for (const button of buttons) {
        if (button === node) { continue }
        if (!button.dataset.display) {
            button.dataset.display = 'next'
        } else {
            delete button.dataset.display
        }
    }
}

KEDDocument.prototype.handleDragEvent = function (event) {
    event.preventDefault()
    switch (event.type) {
        case 'dragover':
            if (!this.domNode.classList.contains('highlight')) {
                this.domNode.classList.add('highlight')
            }
            break
        case 'dragleave':
            this.domNode.classList.remove('highlight')
            break
    }
}

KEDDocument.prototype.handleDropEvent = function (event) {
    event.preventDefault()
    event.stopPropagation()
    this.domNode.classList.remove('highlight')
    this.dropCallback(event)
}

KEDDocument.search = function (pathid) {
    if (window.KEDDocumentRegistry === undefined) {
        window.KEDDocumentRegistry = new Map()
    }   
    for (let [idx, value] of window.KEDDocumentRegistry) {
        if (value.doc.id === pathid) {
            return value
        }
    }
    return undefined
}

KEDDocument.get = function (id, api, forceRefresh = false) {
    return new Promise((resolve, reject) => {
        let kedDoc = KEDDocument.registered(id)
        if (!forceRefresh && kedDoc) {
            resolve(kedDoc)
        } else {
            api.getDocument(id)
            .then(result => {
                if (!result) {
                    resolve(null)
                    return
                }
                resolve(new KEDDocument(result, api))
            })
            .catch (reason => reject(reason))
        }
    })
}

KEDDocument.registered = function (id) {
    if (window.KEDDocumentRegistry === undefined) {
        window.KEDDocumentRegistry = new Map()
    }   
    return window.KEDDocumentRegistry.get(id)
}

KEDDocument.prototype.handleClickEvent = function (event) {
    let actionNode = event.target
    while (actionNode && !actionNode.dataset?.action) {
        actionNode = actionNode.parentNode
    }
    
    if (!actionNode) { return; }

    switch(actionNode.dataset.action) {
        case 'remove-tag':
            this.removeTagInteract(); break
        case 'archive-document':
            this.API.archive(this)
            .then(result => {
                if (result.ok) {
                    this.remove();
                }
            })
            break
    }

    const newEvent = new CustomEvent(actionNode.dataset.action, {detail: {target: this, eventTarget: actionNode}})
    this.EvtTarget.dispatchEvent(newEvent)
}

/* events are installed only once */
KEDDocument.prototype.addEventListener = function (event, callback, options = {}) {
    if (event === 'drop') {
        this.dropCallback = callback
        return
    }
    if (this.installedEvents.indexOf(event) !== -1) { return }    
    this.EvtTarget.addEventListener(event, callback, options)
    this.installedEvents.push(event)
}

KEDDocument.prototype.register = function () {
    window.KEDDocumentRegistry.set(this.doc.abspath, this)
}

KEDDocument.prototype.meta = function() {
    const doc = this.doc
    if (doc['+childs'] > 0) {
        KEDAnim.push(() => {
            this.domNode.classList.add('with-entries')
        })
    }
}

KEDDocument.prototype.remove = function () {
    if (this.domNode) {
        const domNode = this.domNode
        KEDAnim.push(() => { console.log(domNode); domNode.parentNode.removeChild(domNode) })
        try {
            this.domNode = undefined
        } catch (e) { /* ignore  */ }
    }
}

KEDDocument.prototype.getDomNode = function () {
    return this.domNode
}

KEDDocument.prototype.getId = function () {
    return this.doc.abspath
}

KEDDocument.prototype.getRelativeId = function () {
    return this.doc.id
}

KEDDocument.prototype.applyStates = function () {
    if (!this.domNode) { return }
    const oNode = this.domNode.querySelector('i[name="open"]')
    if (this.state.open) {
        KEDAnim.push(() => {
            oNode.classList.add('fa-folder-open')
            oNode.classList.remove('fa-folder')
        })
    } else {
        KEDAnim.push(() => {
            oNode.classList.remove('fa-folder-open')
            oNode.classList.add('fa-folder')
        })
    }
    if (this.state.highlight) {
        KEDAnim.push(() => {
            this.domNode.classList.add('highlight')
        })
    } else {
        KEDAnim.push(() => {
            this.domNode.classList.remove('highlight')
        })
    }
    if (this.state.locked) {
        KEDAnim.push(() => {
            this.domNode.classList.add('locked')
        })
    } else {
        KEDAnim.push(() => {
            this.domNode.classList.remove('locked')
        })
    }
}

KEDDocument.prototype.isOpen = function () {
    return this.state.open
}

KEDDocument.prototype.open = function () {
    this.state.open = true
}

KEDDocument.prototype.close = function () {
    this.state.open = false
}

KEDDocument.prototype.highlight = function (timer = 0) {
    this.state.highlight = true
    if (timer > 0) {
        setTimeout(() => {
            this.lowlight()
            this.applyStates()
        }, timer * 1000)
    }
}

KEDDocument.prototype.uploadStart = function (uploadCount) {
    const ksubmenu = this.domNode.querySelector('div.ksubmenu')
    let newCount = true
    if (!this.uploadInProgress) {
        this.uploadInProgress = {
            ksubmenu: ksubmenu,
            count: uploadCount,
            currentCount: 0
        }
    } else {
        this.uploadInProgress.count += uploadCount
        newCount = false
    }
    if (newCount) {
        const newKSubMenu = document.createElement('DIV')
        newKSubMenu.innerHTML = `Chargement : ${'<i class="fas fa-upload"></i>&nbsp;'.repeat(uploadCount)}`
        newKSubMenu.classList.add('ksubmenu', 'upload')
        KEDAnim.push(() => {
            ksubmenu.parentNode.insertBefore(newKSubMenu, ksubmenu)
            ksubmenu.parentNode.removeChild(ksubmenu)
        })
    } else {
        const ksubmenu = this.domNode.querySelector('div.ksubmenu')
        KEDAnim.push(() => { ksubmenu.innerHTML += `${'<i class="fas fa-upload"></i>&nbsp;'.repeat(uploadCount)}` })
    }
}

KEDDocument.prototype.uploadNext = function () {
    const ksubmenu = this.domNode.querySelector('div.ksubmenu')
    const symbols = ksubmenu.querySelectorAll('i')
    const currentCount = this.uploadInProgress.currentCount
    this.uploadInProgress.currentCount++
    KEDAnim.push(() => { symbols[currentCount].classList.add('done') })
}

KEDDocument.prototype.uploadEnd = function () {
    if (this.uploadInProgress.currentCount >= this.uploadInProgress.count) {
        const newKSubMenu = this.domNode.querySelector('div.ksubmenu')
        const ksubmenu = this.uploadInProgress.ksubmenu
        delete this.uploadInProgress
        setTimeout(() => {
            KEDAnim.push(() => {
                if (!newKSubMenu) { return }
                newKSubMenu.parentNode.insertBefore(ksubmenu, newKSubMenu)
                newKSubMenu.parentNode.removeChild(newKSubMenu)
            })
        }, 1500)
    }
}

KEDDocument.prototype.lowlight = function () {
    this.state.highlight = false
}

KEDDocument.prototype.isLockable = function () {
    return new Promise(resolve => {
        // not locked so I can 
        if (!this.state.locked) { resolve(true); return }
        this.API.getClientId()
        .then(clientid => {
            if (clientid === this.state.locked) { resolve(true); return}
            resolve(false)
        })
    })
}

KEDDocument.prototype.lock = function () {
    this.API.getClientId()
    .then(clientid => {
        this.state.locked = clientid
        this.API.lock(this)
        .then(() => {
            this.applyStates()
        })
    })
}

KEDDocument.prototype.unlock = function () {
    this.state.locked = false
    this.API.unlock(this)
    .then(() => {
        this.applyStates()
    })
}

KEDDocument.prototype.receiveLock = function (clientid) {
    this.state.locked = clientid
    this.applyStates()
}

KEDDocument.prototype.receiveUnlock = function (clientid) {
    if (this.state.locked && this.state.locked !== false && this.state.locked !== clientid) {
        console.log('Lock unlocked by ', clientid, ' when ', this.state.locked, ' seems to have it')
    }
    this.state.locked = false
    this.applyStates()
}

/* compare incoming data from actual data */
KEDDocument.prototype.compare = function (doc) {
    const changes = []
    for (const attr of [
        '+childs',
        '+class',
        '+entries',
        '+history',
        'created',
        'modified',
        'name',
        'tags'
    ]) {
        if (!this.doc) {
            changes.push(attr)
            continue
        }
        if (
            Array.isArray(this.doc[attr]) && !Array.isArray(doc[attr]) ||
            !Array.isArray(this.doc[attr]) && Array.isArray(doc[attr])
        ) {
            /* 0 length array are equal to 0 */
            if (Array.isArray(this.doc[attr])) {
                if (this.doc[attr].length === doc[attr]) {
                    continue
                }
            }
            if (Array.isArray(doc[attr])) {
                if (doc[attr].length === this.doc[attr]) {
                    continue
                }
            }
            changes.push(attr)
            continue
        }
        if (Array.isArray(this.doc[attr]) && Array.isArray(doc[attr])) {
            if (this.doc[attr].length !== doc[attr].length) {
                changes.push(attr);
                continue
            }
            if (this.doc[attr].length === 0) { continue; }
            let changed = false
            for (const value of this.doc[attr]) {
                if (doc[attr].indexOf(value) === -1) {
                    changes.push(attr)
                    changed = true
                    break
                }
            }
            if (changed) { continue } 
            for (const value of doc[attr]) {
                if (this.doc[attr].indexOf(value) === -1) {
                    changes.push(attr)
                    break
                }
            }
            continue
        }
        if (String(this.doc[attr]) !== String(doc[attr])) {
            changes.push(attr)
        }
    }
    return changes
}

KEDDocument.prototype.closeConfirm = function (eventOrNode) {
    if (!eventOrNode) { return }
    if (eventOrNode instanceof HTMLElement) {
        KEDAnim.push(() => {
            if (eventOrNode.parentNode) { eventOrNode.parentNode.removeChild(eventOrNode) }
        })
        return
    }

    let node = eventOrNode.target
    while (node && !node.classList.contains('kconfirm')) { node = node.parentNode }
    this.closeConfirm(node)
}

KEDDocument.prototype.confirm = function (formNode) {
    if (this.currentConfirm) {
        this.currentConfirm.querySelector('form')?.reset()
        this.closeConfirm(this.currentConfirm)
        this.currentConfirm = null
    }

    formNode.addEventListener('reset', event => { this.closeConfirm(event) })
    formNode.addEventListener('submit', event => { this.closeConfirm(event) })

    this.currentConfirm = document.createElement('DIV')
    this.currentConfirm.classList.add('kconfirm')
    this.currentConfirm.appendChild(formNode)
    const metaNode = this.domNode.querySelector('.kmetadata')
    KEDAnim.push(() => { metaNode.appendChild(this.currentConfirm) })
    .then(() => {
        formNode.querySelector('input')?.focus()
    })
}

KEDDocument.prototype.removeTagInteract = function () {
    this.domNode.classList.add('remove-tag')

    const replaceTagInteractionFunction = function (event) {
        let node = event.target
        if (event.target.classList.contains('fa-hashtag')) {
            while (node && !node.dataset.tagid) { node = node.parentNode }
            if (!node) { return }
        }
        if (!node.dataset.tagid) { return }
        event.stopPropagation()
        if (node.classList.contains('condamned')) {
            node.classList.remove('condamned')
        } else {
            node.classList.add('condamned')
        }      
    }.bind(this)

    const handleFormEvent = function (event) {
        this.domNode.removeEventListener('click', replaceTagInteractionFunction, {capture: true})
        const condmanedTag = this.domNode.querySelectorAll('.ktag.condamned')
        const toRemove = []
        for (const tag of condmanedTag) {
            toRemove.push(tag.dataset.tagid)
            KEDAnim.push(() => {
                tag.classList.remove('condamned')
            })
        }
        if (event.type === 'reset') { return }
        event.preventDefault()
        if(toRemove.length <= 0) { return; }
        this.API.removeTag(this.domNode.id, toRemove)
        .then(result => {
            if (result.ok) {
                for (const tag of condmanedTag) {
                    KEDAnim.push(() => {
                        if (tag.parentNode) { tag.parentNode.removeChild(tag) }
                    })
                }
            }
        })
    }.bind(this)

    this.domNode.addEventListener('click', replaceTagInteractionFunction, {capture: true})
    
    const confirmForm = document.createElement('FORM')
    confirmForm.innerHTML = '<div class="kform-inline">Sélectionnez les tags à supprimer.<button type="submit">Supprimer les tags</button><button type="reset">Annuler</button></div>'

    confirmForm.addEventListener('reset', (event) => { handleFormEvent(event) })
    confirmForm.addEventListener('submit', (event) => { handleFormEvent(event) })


    this.confirm(confirmForm)
}