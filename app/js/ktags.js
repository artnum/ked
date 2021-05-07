function KTag (tag) {
    this.tag = tag
}

KTag.prototype.html = function () {
    const node = document.createElement('span')
    node.classList.add('ktag')
    node.dataset.tagid = this.tag
    node.innerHTML = `<i class="fas fa-hashtag"> </i>${this.tag}`
    return node;
}