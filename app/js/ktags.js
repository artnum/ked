function KTag (tag) {
    this.tag = tag
    this.state = false
    this.eventTarget = new EventTarget()
}

KTag.prototype.addEventListener = function (type, listener, options) {
    this.eventTarget.addEventListener(type, listener, options)
}

KTag.prototype.html = function (addon) {
    const node = document.createElement('span')
    if (this.state) {
        node.classList.add('selected')    
    }
    node.classList.add('ktag')
    node.dataset.tagid = this.tag
    node.innerHTML = `<i class="fas fa-hashtag"></i>${this.tag}`
    if (typeof addon === 'string') {
        node.innerHTML += `<span class="addon">${addon}</span>`
    }
    node.addEventListener('click', this.toggle.bind(this))
    this.addEventListener('set-state', function (event) {
        const tag = event.detail
        if (tag.state) {
            if (!this.classList.contains('selected')) { this.classList.add('selected') }
        } else {
            this.classList.remove('selected')
        }
    }.bind(node))
    return node;
}

KTag.prototype.toggle = function (event) {
    if (this.state) {
        event.target.classList.remove('selected')
        this.state = false
    } else {
        event.target.classList.add('selected')
        this.state = true
    }
    this.eventTarget.dispatchEvent(new CustomEvent('change', {detail: this}))
    return this.state
}

KTag.prototype.unset = function () {
    this.state = false
    this.eventTarget.dispatchEvent(new CustomEvent('set-state', {detail: this}))
    return this.state
}

KTag.prototype.set = function () {
    this.state = true
    this.eventTarget.dispatchEvent(new CustomEvent('set-state', {detail: this}))
    return this.state   
}