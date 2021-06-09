function KEDAnimator() {
    this.animSpeed = 1000 / 50
    this.animList = []
}

KEDAnimator.prototype.push = function (callback) {
    const p = new Promise((resolve) => {
        this.animList.push([callback, resolve])
    })
    if (!this._run) { this.run() }
    return p
}
    
KEDAnimator.prototype.run = function () {
    new Promise((resolve) => {
        this._run = true
        window.requestAnimationFrame((start) => {
            while(performance.now() - start < this.animSpeed) {
                const op = this.animList.shift()
                if (op === undefined) { break; }
                op[0]()
                op[1]()
            }
            resolve()
        })
    })
    .then(() => {
        if (this.animList.length > 0) {
            this.run()
        }
        this._run = false
    })
}

const KEDAnim = new KEDAnimator()