function KEDDocument (doc) {
    if (window.KEDDocumentRegistry === undefined) {
        window.KEDDocumentRegistry = new Map()
    }
    const kedDocument = KEDDocument.registered(doc.abspath) || this
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
            `<div class="has-childs indicator"><span data-action="toggle-entries"><i name="open" class="fas fa-folder"></i></span></div>` +
            `<div class="ksubmenu">` +
            `<button class="kui small" data-action="add-text"><i class="fas fa-file-alt"> </i>&nbsp;Texte</button>` +
            `<button class="kui small" data-action="upload-file"><i class="fas fa-cloud-upload-alt"> </i>&nbsp;Fichier</button>` +
            `<button class="kui small danger" data-action="delete-document"><i class="fas fa-trash"> </i>&nbsp;Supprimer</button>` +
            `</div>` +
            `<div id="tag-${doc.id}" class="ktags"><span class="ktags-tools" data-action="add-tag"><i class="fas fa-plus-circle"></i></span></div>` +
            `</div>`
    }

    if (doc['+lock']) {
        kedDocument.state.locked = doc['+lock']
    }

    kedDocument.meta() // set metadata
    kedDocument.register()
    kedDocument.applyStates()

    return kedDocument
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

KEDDocument.get = function (id, api) {
    return new Promise((resolve, reject) => {
        let kedDoc = KEDDocument.registered(id)
        if (kedDoc) {
            resolve(kedDoc)
        } else {
            api.getDocument(id)
            .then(result => {
                if (!result) {
                    resolve(null)
                    return
                }
                resolve(new KEDDocument(result))
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
    const newEvent = new CustomEvent(actionNode.dataset.action, {detail: {target: this, eventTarget: actionNode}})
    this.EvtTarget.dispatchEvent(newEvent)
}

/* events are installed only once */
KEDDocument.prototype.addEventListener = function (event, callback, options = {}) {
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

KEDDocument.prototype.lowlight = function () {
    this.state.highlight = false
}

KEDDocument.prototype.isLockable = function (api) {
    return new Promise(resolve => {
        // not locked so I can 
        if (!this.state.locked) { resolve(true); return }
        api.getClientId()
        .then(clientid => {
            if (clientid === this.state.locked) { resolve(true); return}
            resolve(false)
        })
    })
}

KEDDocument.prototype.lock = function (api) {
    api.getClientId()
    .then(clientid => {
        this.state.locked = clientid
        api.lock(this)
        .then(() => {
            this.applyStates()
        })
    })
}

KEDDocument.prototype.unlock = function (api) {
    this.state.locked = false
    api.unlock(this)
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
