/* The live Agent File: one session per Agent Code, shared by every place
   that shows the paper (the Field Notes notebook and Agent Hub). It holds
   the Agent's saved state (characters/{code}.character_json), applies
   changes made at the table and saves them after a short pause (the same
   dgStore.saveCharacter the character sheet uses), and follows the
   document live so another device's change shows up.

   Edit mode works on a copy of the state; nothing is saved until the
   Oath is taken (commitEdit), and Cancel throws the copy away. The copy
   lives on the session, so leaving the page in the notebook and coming
   back finds the edit still open.

   window.dgAgentLive = { session(code, char), get(code) } */
(function () {
  'use strict';
  if (window.dgAgentLive) return;

  var sessions = {};
  var SAVE_DELAY = 700;

  function clone(o) { return JSON.parse(JSON.stringify(o || {})); }
  function parse(char) {
    try { return char && char.character_json ? JSON.parse(char.character_json) : null; } catch (e) { return null; }
  }

  function Session(code, char) {
    this.code = code;
    this.state = parse(char);
    if (this.state && window.dgRules) window.dgRules.normalizeBio(this.state);
    this.char = char || null;
    this.edit = null;          // Edit mode's working copy
    this.listeners = [];
    this.saveTimer = null;
    this.saving = null;
    this.lastJson = this.state ? JSON.stringify(this.state) : '';
    this.status = '';
    this.unsub = null;
    this.watch();
  }
  Session.prototype.on = function (fn) {
    var self = this;
    this.listeners.push(fn);
    return function () { self.listeners = self.listeners.filter(function (f) { return f !== fn; }); };
  };
  Session.prototype.emit = function (why) {
    var self = this;
    this.listeners.slice().forEach(function (fn) { try { fn(self, why); } catch (e) { console.error('agent-live listener', e); } });
  };
  // A change made at the table: applied now, saved after a short pause.
  // fn(state) may return a Promise (a roll); the save waits for it.
  Session.prototype.update = function (fn, why) {
    var self = this;
    if (!this.state) return Promise.resolve();
    var r;
    try { r = fn(this.state); } catch (e) { console.error(e); return Promise.reject(e); }
    return Promise.resolve(r).then(function (v) {
      self.emit(why || 'update');
      self.scheduleSave();
      return v;
    });
  };
  Session.prototype.scheduleSave = function () {
    var self = this;
    clearTimeout(this.saveTimer);
    this.setStatus('Saving…');
    this.saveTimer = setTimeout(function () { self.saveNow(); }, SAVE_DELAY);
  };
  Session.prototype.saveNow = function () {
    var self = this;
    clearTimeout(this.saveTimer);
    if (!this.state || !window.dgStore) return Promise.resolve();
    var json = JSON.stringify(this.state);
    this.lastJson = json;
    var p = window.dgStore.saveCharacter(this.code, JSON.parse(json)).then(function () {
      if (self.saving === p) { self.saving = null; self.setStatus('Saved'); }
    }, function (err) {
      if (self.saving === p) self.saving = null;
      self.setStatus('Not saved — check the connection');
      console.error('agent-live: save failed', err);
      throw err;
    });
    this.saving = p;
    return p;
  };
  Session.prototype.setStatus = function (s) {
    this.status = s;
    this.listeners.slice().forEach(function (fn) { try { fn.status && fn.status(s); } catch (e) { /* ignore */ } });
    try { document.querySelectorAll('[data-ap-status="' + this.code + '"]').forEach(function (el) { el.textContent = s; }); } catch (e) { /* no page */ }
  };
  // Follow the Agent's document: a change from elsewhere (another device,
  // the Handler's Incursion edit) replaces the state, unless this page has
  // a save of its own on the way.
  Session.prototype.watch = function () {
    var self = this;
    if (!window.dgStore || !window.dgStore.ready) return;
    window.dgStore.ready().then(function () {
      if (self.unsub || !window.firebase || !window.firebase.firestore) return;
      self.unsub = window.firebase.firestore().collection('characters').doc(self.code).onSnapshot(function (snap) {
        var d = snap && (snap.data ? snap.data() : null);
        if (!d) return;
        self.char = Object.assign({}, self.char || {}, d);
        if (!d.character_json || d.character_json === self.lastJson) { self.emit('doc'); return; }
        if (self.saveTimer || self.saving) return; // ours is newer
        var st = parse(d);
        if (!st) return;
        if (window.dgRules) window.dgRules.normalizeBio(st);
        self.state = st;
        self.lastJson = JSON.stringify(st);
        self.emit('remote');
      }, function () { /* offline: keep what we have */ });
    }).catch(function () { /* no Firebase here */ });
  };

  /* ── Edit mode ── */
  Session.prototype.beginEdit = function () { if (!this.edit && this.state) this.edit = clone(this.state); this.emit('edit'); return this.edit; };
  Session.prototype.cancelEdit = function () { this.edit = null; this.emit('edit'); };
  Session.prototype.editDirty = function () { return !!this.edit && JSON.stringify(this.edit) !== JSON.stringify(this.state); };
  Session.prototype.commitEdit = function () {
    if (!this.edit) return Promise.resolve();
    this.state = this.edit;
    this.edit = null;
    this.emit('commit');
    return this.saveNow();
  };

  function session(code, char) {
    code = String(code || '').toUpperCase();
    if (!code) return null;
    var s = sessions[code];
    if (!s) {
      s = sessions[code] = new Session(code, char);
    } else if (char && !s.state && char.character_json) {
      s.state = parse(char); s.char = char;
      if (s.state && window.dgRules) window.dgRules.normalizeBio(s.state);
      s.lastJson = s.state ? JSON.stringify(s.state) : '';
    }
    return s;
  }

  // Leaving the page with an unsaved edit asks first; a play change still
  // waiting to save is sent now.
  window.addEventListener('beforeunload', function (e) {
    var dirty = false;
    Object.keys(sessions).forEach(function (k) {
      var s = sessions[k];
      if (s.saveTimer) s.saveNow();
      if (s.editDirty()) dirty = true;
    });
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  window.dgAgentLive = { session: session, get: function (code) { return sessions[String(code || '').toUpperCase()] || null; } };
})();
