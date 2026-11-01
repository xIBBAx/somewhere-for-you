// Loading progress reported by the game (never moves backwards). Plain
// script, so the progress shows before the game's bundle has arrived.
(function () {
  var el = document.getElementById("boot-screen"), shown = 0
  try { if (el && sessionStorage.getItem("gift-world/refresh")) el.setAttribute("data-refresh", "") } catch (e) { /* storage unavailable */ }
  window.__bootProgress = function (value) {
    if (!el || !(value > shown)) return
    shown = Math.min(1, value)
    el.style.setProperty("--p", shown.toFixed(3))
    el.setAttribute("aria-valuenow", String(Math.round(shown * 100)))
    var veil = document.getElementById("letter-veil")
    var link = veil && veil.shadowRoot && veil.shadowRoot.querySelector("[data-letter-enter]")
    if (link) link.style.setProperty("--p", shown.toFixed(3))
    if (veil && shown >= 1) veil.setAttribute("data-ready", "")
  }
  window.__bootProgress(0.04)
})()
