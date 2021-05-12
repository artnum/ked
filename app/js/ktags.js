function KTag (tag) {
    this.tag = tag
    this.state = false
    this.eventTarget = new EventTarget()
}

KTag.prototype.addEventListener = function (type, listener, options) {
    this.eventTarget.addEventListener(type, listener, options)
}

KTag.prototype.html = function () {
    const node = document.createElement('span')
    if (this.state) {
        node.classList.add('selected')    
    }
    node.classList.add('ktag')
    node.dataset.tagid = this.tag
    node.innerHTML = `<i class="fas fa-hashtag"> </i>${this.tag}`
    node.addEventListener('click', this.toggle.bind(this))
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
    this.eventTarget.dispatchEvent(new Event('change', {target: this}))
    return this.state
}