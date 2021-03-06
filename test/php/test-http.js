const _fetch = fetch

fetch = function (url, options) {
    console.log(options);
    return _fetch(url, options)
}

const url = new URL('../../web/index.php', window.location)
function out (response) {
    const out = document.getElementById('results')
    out.value += `HTTP Code : ${response.status}\n`
    response.clone().text().then(console.log)
    if (response.ok) {
        response.json().then(result => {
            out.value += '--- CONTENT ---\n'
            out.value += JSON.stringify(result)
            out.value += '\n---------------\n'
        })
    }
}

function searchByTags (event) {
    const tags = event.target.nextElementSibling.value.split(',').map(v => v.trim())
    const operation = {
        operation: 'search-by-tags',
        tags
    }
    fetch(url, {
        method: 'POST',
        body: JSON.stringify(operation)
    }).then(out)
}

function searchTags (event) {
    const expression = event.target.nextElementSibling.value
    const operation = {
        operation: 'search-tags',
        expression,
        maxsize: 10
    }
    fetch(url, {
        method: 'POST',
        body: JSON.stringify(operation)
    }).then(out)
}

function createTag (event) {
    const name = event.target.nextElementSibling.value
    const related = event.target.nextElementSibling.nextElementSibling.value.split(',').map(v => v.trim())
    const operation = {
        operation: 'create-tag',
        name,
        related
    }
    fetch(url, {
        method: 'POST',
        body: JSON.stringify(operation)
    }).then(out)
}

function addTag (event) {
    const path = event.target.nextElementSibling.value
    const tag = event.target.nextElementSibling.nextElementSibling.value
    const operation = {
        operation: 'add-document-tag',
        tag,
        path
    }
    fetch(url, {
        method: 'POST',
        body: JSON.stringify(operation)
    }).then(out)
}

function createDocument (event) {
    const name = event.target.nextElementSibling.value
    const path = event.target.nextElementSibling.nextElementSibling.value
    const tags = event.target.nextElementSibling.nextElementSibling.nextElementSibling.value
    const operation = {
        operation: 'create-document',
        application: null
    }
    if (name && name !== '') {
        operation['name'] = name
    }
    if (path && path !== '') {
        operation['path'] = path
    }
    if (tags && tags !== '') {
        let t = tags.split(',')
        if (t.length > 0) {
            operation['tags'] = []
            t.forEach(value => {
                operation['tags'].push(value.trim())
            })
        }
    }
    fetch(url, {
        method: 'POST',
        body: JSON.stringify(operation)
    }).then(out)
}

function listDocument (event) {
    const path = event.target.nextElementSibling.value
    const body = {
        operation: 'list-document'
    }
    if (path && path !== '') {
        body['path'] = path
    }
    fetch(url,{
        method: 'POST',
        body: JSON.stringify(body)
    }).then(out)
}

function getDocument (event) {
    const path = event.target.nextElementSibling.value
    if (!(path && path !== null)) { return }
    const body = {
        operation: 'get-document',
        path
    }
    fetch (url, {
        method: 'POST',
        body: JSON.stringify(body)
    }).then(out)
}

function listDocumentExtended (event) {
    const path = event.target.nextElementSibling.value
    const body = {
        operation: 'list-document',
        format: 'extended'
    }
    if (path && path !== '') {
        body['path'] = path
    }
    fetch(url,{
        method: 'POST',
        body: JSON.stringify(body)
    }).then(out)
}
function addEntry (event) {
    const path = event.target.nextElementSibling.value
    const files = event.target.nextElementSibling.nextElementSibling.files
    if (files.length < 1) { return }
    const file = files.item(0)
    let query = new FormData()
    query.append('operation', 'add-entry')
    query.append('file', file)
    query.append('path', path)
    query.append('_filename', file.name)
    fetch(url, {
        method: 'POST',
        body: query
    }).then(out)
}

function deleteAny (event) {
    const path = event.target.nextElementSibling.value
    const body = {
        operation: 'delete',
        path
    }
    fetch (url, { method: 'POST', body: JSON.stringify(body)}).then(out)
}