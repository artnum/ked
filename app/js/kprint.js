function KEDPrint(keditor, location) {
    this.ked = keditor
    this.location = location
}

KEDPrint.prototype.kdoc = function (kdoc, output) {
    this.ked.API.getDocument(kdoc.getId())
    .then(fulldoc => {
        output.focus()
        const doc = output.document
        doc.head.appendChild(doc.createElement('TITLE'))
        doc.head.firstChild.innerHTML = fulldoc.name

        const style = `
            .kimage img { max-width:  100%;}
            .kentry.ktext { border-bottom: 1px solid lightgray; font-family: sans-serif; }
            footer { position: fixed; bottom: 0; font-family: monospace; font-size: 8pt; background-color: white; }
            .kdates span { margin-right: 1ch; }
        `
        doc.head.appendChild(document.createElement('STYLE'))
        doc.head.lastElementChild.innerHTML = style

        fetch(`${this.location.toString()}../css/quills.css`)
        .then(response => {
            return response.text()
        })
        .then(content => {
            const quillStyle = document.createElement('STYLE')
            quillStyle.innerHTML = content
            doc.head.appendChild(quillStyle)
        })
        doc.body.innerHTML = `
            <h1>${kdoc.doc.name}</h1>
            <footer>
            <div class="kusers">${kdoc.doc.name} - ${kdoc.htmlUserList()}</div>
            <div class="kdates">${kdoc.dates()}<span class="printed">Imprimé le ${new Date().toLocaleDateString(undefined, {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}</span></div>
            </footer>
        `
        const grid = doc.createElement('DIV')
        grid.classList.add('entries')
        grid.style.setProperty('display', 'grid')
        grid.style.setProperty('grid-template-columns', '1fr')
        grid.style.setProperty('grid-template-rows', 'auto')
        grid.style.setProperty('row-gap', '1cm')


        doc.body.appendChild(grid)
        let order = 0
        for (let k in fulldoc['+entries']) {
            order++
            const entry = fulldoc['+entries'][k]
            const subtype = entry.type.split('/', 2)
            switch(subtype[0]) {
                default: break
                case 'image':
                    this.ked.API.getUrl(`${this.ked.baseUrl.toString()}/${entry.abspath}`)
                    .then(url => {
                        const div = doc.createElement('DIV')
                        const img = doc.createElement('IMG')
                        img.setAttribute('src', url.toString())
                        div.classList.add('kimage', 'kentry')
                        div.appendChild(img)
                        div.style.setProperty('order', order + 10000)
                        grid.appendChild(div)
                    })
                    break
                case 'text':
                    this.ked.API.fetch(`${this.ked.baseUrl.toString()}/${entry.abspath}`)
                    .then(response => {
                        if (!response.ok) { return null }
                        return response.text()
                    })
                    .then (content => {
                        const htmlnode = doc.createElement('DIV')
                        htmlnode.style.setProperty('order', order)
                        htmlnode.classList.add('kentry', 'ktext')
                        switch(subtype[1]) {
                            case 'html':
                                let x = doc.createElement('HTML')
                                x.innerHTML = content
                                htmlnode.innerHTML = x.getElementsByTagName('BODY')[0].innerHTML
                                htmlnode.classList.add('htmltext')
                                grid.appendChild(htmlnode)
                                break
                            case 'x-quill-delta':
                                /* we display a transformed version, so keep data as original form */
                                const tmpContainer = doc.createElement('DIV')
                                const quill = new Quill(tmpContainer)
                                quill.setContents(JSON.parse(content))
                                htmlnode.innerHTML = quill.root.innerHTML
                                htmlnode.classList.add('quilltext')
                                htmlnode.dataset.edit = 'quills'
                                grid.appendChild(htmlnode)
                                break
                            default:
                                htmlnode.innerHTML = content
                                htmlnode.classList.add('plaintext')
                                htmlnode.dataset.edit = 'text'
                                grid.appendChild(htmlnode)
                                break
                        }
                    })
                    break
            }
        }
    })
}