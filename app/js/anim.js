function KEDAnimator() {
}

KEDAnimator.prototype.push = function (callback) {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => { callback(); resolve() })
    })
}
const KEDAnim = new KEDAnimator()