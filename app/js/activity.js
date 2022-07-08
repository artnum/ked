function KEDActivity (timeOfInactivity = 5 /* minutes */) {
    if (KEDActivity._instance) { return KEDActivity._instance }
    this.timeOfInactivity = timeOfInactivity * 60 // to second
    this.activityCount = 0
    this.timer = null
    this.actions = new Map()

    this.startTimer()
    
    for (const event of ['mousedown', 'keydown', 'focus', 'touchstart', 'focus', 'scroll']) {
        document.addEventListener(event, () => {
            this.activityCount = 0
            this.startTimer()
        }, {capture: true, passive: true})
    }
}

KEDActivity.prototype.startTimer = function () {
    if (this.timer) { return }
    this.timer = setInterval(() => {
        this.activityCount++
        if (this.activityCount > this.timeOfInactivity) {
            this.run()
        }
    }, 1000)
}

KEDActivity.prototype.run = function () {
    clearInterval(this.timer)
    this.timer = null
    for (const [_, callback] of this.actions) {
        callback()
    }
    this.actions = new Map()
}

KEDActivity.prototype.set = function (name, callback) {
    return this.actions.set(name, callback)
}

KEDActivity.prototype.remove = function (name) {
    return this.actions.delete(name)
}

KEDActivity.prototype.has = function (name) {
    return this.actions.has(name)
}

KEDActivity.prototype.ping = function () {
    this.activityCount = 0
}