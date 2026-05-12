/* ============================================================
   TOUSTREAM — native mobile-app behavior layer
   Runs at document_start on every page load (main frame only).
   ============================================================ */
(function () {
  if (window.__TS_MOBILE__) return;
  window.__TS_MOBILE__ = true;

  var TABS = [
    { id: "home",      label: "Home",      icon: "fa-house",            href: "/index.html" },
    { id: "movies",    label: "Movies",    icon: "fa-film",             href: "/movies.html" },
    { id: "series",    label: "Series",    icon: "fa-tv",               href: "/series.html" },
    { id: "search",    label: "Search",    icon: "fa-magnifying-glass", href: "/search.html" },
    { id: "watchlist", label: "Watchlist", icon: "fa-bookmark",         href: "/watchlist.html" }
  ];

  function path() {
    var p = (location.pathname || "/").toLowerCase();
    if (p === "/" || p.endsWith("/index.html") || p === "/index") return "home";
    if (p.includes("movies"))    return "movies";
    if (p.includes("series") || p.includes("tv")) return "series";
    if (p.includes("search"))    return "search";
    if (p.includes("watchlist")) return "watchlist";
    return "";
  }

  function isPlayerPage() {
    var p = (location.pathname || "").toLowerCase();
    return /(watch|player|embed|stream)/.test(p);
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  function buildTopBar() {
    if (document.getElementById("ts-topbar")) return;
    var bar = el("div", { id: "ts-topbar" });

    var leftWrap = el("div", { class: "ts-left", style: "display:flex;align-items:center;" });
    var canBack = window.history && window.history.length > 1 && path() !== "home";
    if (canBack) {
      var back = el("button", { class: "ts-back", "aria-label": "Back",
        html: '<i class="fas fa-chevron-left"></i>' });
      back.addEventListener("click", function () { history.back(); });
      leftWrap.appendChild(back);
    }
    var brand = el("div", { class: "ts-brand",
      html: '<i class="fa-solid fa-play"></i><span>TouStream</span>' });
    leftWrap.appendChild(brand);

    var actions = el("div", { class: "ts-actions" });
    var menuBtn = el("a", { href: "#", "aria-label": "Menu",
      html: '<i class="fas fa-bars"></i>' });
    menuBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var d = document.getElementById("mobile-drawer");
      if (!d) return;
      var open = d.classList.contains("open") || d.classList.contains("is-open") || d.style.transform === "translateX(0px)";
      if (open) {
        d.classList.remove("open"); d.classList.remove("is-open");
        d.style.transform = "";
      } else {
        d.classList.add("open"); d.classList.add("is-open");
        d.style.transform = "translateX(0)";
      }
    });
    actions.appendChild(menuBtn);

    bar.appendChild(leftWrap);
    bar.appendChild(actions);
    (document.body || document.documentElement).appendChild(bar);
  }

  function buildTabBar() {
    if (document.getElementById("ts-tabbar")) return;
    var bar = el("div", { id: "ts-tabbar" });
    var active = path();
    TABS.forEach(function (t) {
      var iconClass = "fas " + t.icon;
      var a = el("a", {
        href: t.href,
        class: t.id === active ? "is-active" : "",
        html: '<i class="' + iconClass + '"></i><span>' + t.label + '</span>'
      });
      if (t.id === "watchlist") {
        var badge = el("span", { class: "ts-badge", id: "ts-wl-badge" });
        a.appendChild(badge);
      }
      bar.appendChild(a);
    });
    (document.body || document.documentElement).appendChild(bar);
  }

  function syncWatchlistBadge() {
    try {
      var raw = localStorage.getItem("watchlist") || localStorage.getItem("ts_watchlist") || "[]";
      var arr = JSON.parse(raw);
      var n = Array.isArray(arr) ? arr.length : 0;
      var b = document.getElementById("ts-wl-badge");
      if (!b) return;
      if (n > 0) { b.style.display = "flex"; b.textContent = n > 99 ? "99+" : String(n); }
      else { b.style.display = "none"; }
    } catch (e) {}
  }

  function flagPlayer() {
    if (isPlayerPage()) document.body.classList.add("ts-fullscreen");
  }

  function ensureFontAwesome() {
    if (document.querySelector('link[href*="font-awesome"]')) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css";
    document.head.appendChild(l);
  }

  /* ============================================================
     PLAYER / VIDEO TRUE-FULLSCREEN PATCHING
     ============================================================
     iOS WKWebView is configured with allowsInlineMediaPlayback=false,
     which makes <video> tags go to the native iOS fullscreen player
     when play() fires. The `playsinline` / `webkit-playsinline`
     attributes would override that and force inline playback — so
     we strip them from every <video>. We also normalize player
     iframes (vidsrc/embed) to fill the viewport and be allowfullscreen,
     and toggle a body.ts-player-open class while one is mounted so
     our top/bottom chrome hides.
  */
  var PLAYER_HOST_RX = /(vidsrc|embed|player|2embed|autoembed|filemoon|streamtape|doodstream|smashy|multiembed|moviesapi|superembed|vidstream|vidcloud|hls|m3u8)/i;

  function isPlayerIframe(el) {
    if (!el || el.tagName !== "IFRAME") return false;
    var src = (el.src || el.getAttribute("src") || "");
    if (PLAYER_HOST_RX.test(src)) return true;
    // Also treat any iframe that fills most of the viewport as a player.
    try {
      var r = el.getBoundingClientRect();
      if (r.width >= window.innerWidth * 0.7 && r.height >= window.innerHeight * 0.45) return true;
    } catch (e) {}
    return false;
  }

  function patchVideo(v) {
    if (!v || v.__tsPatched) return;
    v.__tsPatched = true;
    // Strip inline-playback attributes so iOS auto-fullscreens on play.
    v.removeAttribute("playsinline");
    v.removeAttribute("webkit-playsinline");
    v.removeAttribute("x5-playsinline");
    // Force controls visible and audio on.
    v.setAttribute("controls", "");
    v.muted = false;
    v.removeAttribute("muted");
    // Standard mobile audio routing.
    v.setAttribute("preload", "auto");
    v.setAttribute("x-webkit-airplay", "allow");
    v.setAttribute("airplay", "allow");
  }

  function patchIframe(f) {
    if (!f || f.__tsPatched) return;
    f.__tsPatched = true;
    // Enable fullscreen / autoplay / picture-in-picture inside the embed.
    f.setAttribute("allowfullscreen", "true");
    f.setAttribute("webkitallowfullscreen", "true");
    f.setAttribute("mozallowfullscreen", "true");
    var prev = f.getAttribute("allow") || "";
    var needed = "autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope";
    if (!/fullscreen/.test(prev)) {
      f.setAttribute("allow", (prev + "; " + needed).replace(/^;\s*/, ""));
    }
  }

  function setPlayerOpen(open) {
    document.body.classList.toggle("ts-player-open", !!open);
  }

  // Walk the DOM right now to patch anything already present.
  function patchAll() {
    var videos = document.getElementsByTagName("video");
    for (var i = 0; i < videos.length; i++) patchVideo(videos[i]);
    var iframes = document.getElementsByTagName("iframe");
    var anyPlayer = false;
    for (var j = 0; j < iframes.length; j++) {
      patchIframe(iframes[j]);
      if (isPlayerIframe(iframes[j])) anyPlayer = true;
    }
    setPlayerOpen(anyPlayer);
  }

  function startObservers() {
    if (window.__TS_OBS__) return;
    window.__TS_OBS__ = true;
    // Mutation observer catches dynamically inserted players (the toustream
    // openModal flow appends an iframe into a modal at click time).
    var mo = new MutationObserver(function (muts) {
      var dirty = false;
      muts.forEach(function (m) {
        m.addedNodes && m.addedNodes.forEach(function (n) {
          if (!n || n.nodeType !== 1) return;
          if (n.tagName === "VIDEO") { patchVideo(n); dirty = true; }
          else if (n.tagName === "IFRAME") { patchIframe(n); dirty = true; }
          else if (n.querySelectorAll) {
            n.querySelectorAll("video").forEach(patchVideo);
            n.querySelectorAll("iframe").forEach(function (f) { patchIframe(f); });
            if (n.querySelectorAll("iframe").length) dirty = true;
          }
        });
        m.removedNodes && m.removedNodes.forEach(function (n) {
          if (n && n.nodeType === 1 && (n.tagName === "IFRAME" || (n.querySelector && n.querySelector("iframe")))) {
            dirty = true;
          }
        });
      });
      if (dirty) {
        // Re-evaluate whether a player iframe is currently mounted.
        var anyPlayer = false;
        var iframes = document.getElementsByTagName("iframe");
        for (var i = 0; i < iframes.length; i++) {
          if (isPlayerIframe(iframes[i])) { anyPlayer = true; break; }
        }
        setPlayerOpen(anyPlayer);
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });

    // Also catch programmatic .play() so we can patch right before playback.
    try {
      var origPlay = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.tagName === "VIDEO") patchVideo(this);
        return origPlay.apply(this, arguments);
      };
    } catch (e) {}
  }

  function applyAll() {
    try {
      if (!document.body) return;
      ensureFontAwesome();
      buildTopBar();
      buildTabBar();
      syncWatchlistBadge();
      flagPlayer();
      patchAll();
      startObservers();
    } catch (e) { /* swallow */ }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyAll, { once: true });
  } else {
    applyAll();
  }

  // SPA-style nav re-detect
  var lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      var bar = document.getElementById("ts-tabbar"); if (bar) bar.remove();
      var top = document.getElementById("ts-topbar"); if (top) top.remove();
      applyAll();
    }
    syncWatchlistBadge();
    // Keep iframes patched (the toustream player may swap src after mount).
    patchAll();
  }, 1500);

  window.addEventListener("popstate", applyAll);
  window.addEventListener("storage", syncWatchlistBadge);
  window.addEventListener("wl-changed", syncWatchlistBadge);

  // Double-tap-zoom suppression
  var lastTouch = 0;
  document.addEventListener("touchend", function (e) {
    var now = Date.now();
    if (now - lastTouch < 300) e.preventDefault();
    lastTouch = now;
  }, { passive: false });

  // Edge-swipe back gesture
  var touchStartX = 0, touchStartY = 0, touchStartT = 0;
  document.addEventListener("touchstart", function (e) {
    var t = e.touches[0];
    touchStartX = t.clientX; touchStartY = t.clientY; touchStartT = Date.now();
  }, { passive: true });
  document.addEventListener("touchend", function (e) {
    var t = e.changedTouches[0];
    var dx = t.clientX - touchStartX;
    var dy = Math.abs(t.clientY - touchStartY);
    var dt = Date.now() - touchStartT;
    if (touchStartX < 24 && dx > 80 && dy < 60 && dt < 500 && history.length > 1) {
      history.back();
    }
  }, { passive: true });
})();
