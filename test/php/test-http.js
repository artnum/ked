const _fetch = fetch

fetch = function (url, options) {
    console.log(options);
    return _fetch(url, options)
}

const url = new URL('test-http.php', window.location)
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
            operation['application'] = []
            t.forEach(value => {
                operation['application'].push(`tag=${value.trim()}`)
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