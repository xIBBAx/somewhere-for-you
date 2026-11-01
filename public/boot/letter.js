// The letter is the first page; the world loads behind it. This plain script
// runs before the game's bundle: it fills the letter's words in and wires the
// Enter link. Words come from what the Personalize screen saved in this
// browser, else from the build (customize/gift.json, embedded by Vite as
// #gift-letter), and are only ever set as text, never as HTML.
(function () {
  var veil = document.getElementById("letter-veil")
  var build = {}
  try {
    var embedded = document.getElementById("gift-letter")
    if (embedded) build = JSON.parse(embedded.textContent || "{}") || {}
  } catch (e) { build = {} }
  var local = null
  try {
    var raw = localStorage.getItem("gift-world/personal/v1")
    if (raw) local = JSON.parse(raw)
  } catch (e) { local = null }

  var str = function (v) { return typeof v === "string" ? v : "" }
  var pick = function (path) {
    var get = function (o) {
      for (var i = 0; i < path.length && o; i++) o = o[path[i]]
      return o
    }
    var a = local && get(local)
    return a !== undefined && a !== null && a !== "" ? a : get(build)
  }
  var recipient = str(pick(["recipient", "name"])) || "you"
  var creator = str(pick(["creator", "name"]))
  var heading = str(pick(["title", "heading"]))
  document.title = heading || "A world for " + recipient

  if (!veil) return
  // A tab that has already entered the world (Refresh, F5, a hot reload)
  // resumes it; any explicit link (?skipIntro, ?personalize…) goes straight in.
  var resume = false
  try { resume = sessionStorage.getItem("gift-world/in-world") === "1" } catch (e) { resume = false }
  if (resume || location.search || !(location.pathname === "/" || location.pathname === "/index.html")) { veil.remove(); return }

  var root = veil.shadowRoot
  if (!root) {
    // browsers without declarative shadow DOM
    var tpl = veil.querySelector("template")
    root = veil.attachShadow({ mode: "open" })
    if (tpl) { root.appendChild(tpl.content); tpl.remove() }
  }
  var field = function (name) { return root.querySelector('[data-field="' + name + '"]') }
  var setText = function (name, value) { var el = field(name); if (el) el.textContent = value }

  setText("for", "For " + recipient)
  setText("from", creator ? "From " + creator : "")
  setText("heading", str(pick(["letter", "heading"])) || "Namaste")
  setText("greeting", str(pick(["letter", "greeting"])))
  setText("signoff", str(pick(["letter", "signoff"])))
  setText("enter", str(pick(["letter", "enter"])) || "Enter the world")
  var body = field("paragraphs")
  var paragraphs = pick(["letter", "paragraphs"])
  if (body && Array.isArray(paragraphs)) {
    for (var i = 0; i < paragraphs.length && i < 8; i++) {
      if (typeof paragraphs[i] !== "string" || !paragraphs[i]) continue
      var p = document.createElement("p")
      p.textContent = paragraphs[i]
      body.appendChild(p)
    }
  }
  var accent = str(pick(["theme", "accent"]))
  if (/^#[0-9a-f]{6}$/i.test(accent)) veil.style.setProperty("--accent", accent)
  veil.setAttribute("aria-label", "Before you begin: a letter for " + recipient)
  // the demo world invites its visitor to make their own; a personalized one does not
  var personalize = root.querySelector("[data-personalize]")
  if (personalize && !local && !build.personalized) personalize.hidden = false

  var meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute("content", "#f4eee1")
  var scroller = root.querySelector(".scroller")
  if (scroller && !location.hash) scroller.focus({ preventScroll: true })
  var skip = root.querySelector(".skip-link")
  if (skip) skip.addEventListener("click", function (e) {
    e.preventDefault()
    var letter = root.getElementById("letter")
    if (letter) { letter.scrollIntoView({ block: "start" }); letter.focus({ preventScroll: true }) }
  })
  var enter = root.querySelector("[data-letter-enter]")
  window.__letterEnter = function () {
    if (window.__letterEntered) return
    window.__letterEntered = true
    try { if (window.__letterGesture) window.__letterGesture() } catch (error) { console.error(error) }
    if (meta) meta.setAttribute("content", "#030611")
    veil.setAttribute("data-leaving", "")
    window.dispatchEvent(new Event("letter-entered"))
    setTimeout(function () { veil.remove() }, 1200)
  }
  if (enter) enter.addEventListener("click", function (e) { e.preventDefault(); window.__letterEnter() })
})()
