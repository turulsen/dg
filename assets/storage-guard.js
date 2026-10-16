/* Storage that throws (Safari's "Block All Cookies", some private modes,
   browsers with site data turned off): every page's localStorage /
   sessionStorage calls are wrapped in try/catch, so nothing crashes, but
   nothing is remembered either -- an Agent opened by ?code= never reached
   the roster and Agent Hub showed an empty folder. Loaded first on each
   page: if a storage throws, it is replaced for this visit by one held in
   memory, so the page works as it would on a first visit. Nothing
   survives a reload in that case, which is the best such a browser
   allows. */
(function () {
  function memory() {
    var data = {};
    return {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = {}; },
      key: function (i) { return Object.keys(data)[i] || null; },
      get length() { return Object.keys(data).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    try {
      var s = window[name];
      s.setItem('__dg_probe', '1');
      s.removeItem('__dg_probe');
    } catch (e) {
      try { Object.defineProperty(window, name, { value: memory(), configurable: true }); } catch (e2) { /* leave it */ }
    }
  });
})();
