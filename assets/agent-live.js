/* The live Agent File: one session per Agent Code, shared by every place
   that shows the paper (the Field Notes notebook and Agent Hub). It holds
   the Agent's saved state (characters/{code}.character_json), applies
   changes made at the table and saves them after a short pause, and
   follows the document live so another device's change shows up.

   Saving never undoes someone else's change: the session remembers the
   last state it knew was saved (`base`), and dgStore.saveCharacterMerged
   lays this device's changes since then over the latest saved copy, in a
   transaction (two devices tapping HP − both count). A save that fails --
   offline, a dropped connection -- is tried again, soon and whenever the
   browser says it's back online, until it goes through.

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
    this.base = this.lastJson;   // the last state known to be saved
    this.retryTimer = null;
    this.retries = 0;
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
  var RETRY = [2000, 5000, 10000, 20000, 30000];
  Session.prototype.saveNow = function () {
    var self = this;
    clearTimeout(this.saveTimer); this.saveTimer = null;
    clearTimeout(this.retryTimer); this.retryTimer = null;
    if (!this.state || !window.dgStore) return Promise.resolve();
    var json = JSON.stringify(this.state);
    var base = this.base ? JSON.parse(this.base) : null;
    this.lastJson = json;
    var S = window.dgStore;
    var write = S.saveCharacterMerged ? S.saveCharacterMerged(this.code, base, JSON.parse(json))
      : S.saveCharacter(this.code, JSON.parse(json)).then(function () { return JSON.parse(json); });
    var p = write.then(function (saved) {
      if (self.saving !== p) return;
      self.saving = null; self.retries = 0;
      var savedJson = JSON.stringify(saved || JSON.parse(json));
      self.base = savedJson;
      // Changed again while this was on its way: save that too.
      if (JSON.stringify(self.state) !== json) { self.scheduleSave(); return; }
      if (savedJson !== json) {
        // Someone else's change was folded in: show the merged state.
        self.state = JSON.parse(savedJson);
        self.lastJson = savedJson;
        self.emit('remote');
      }
      self.setStatus('Saved');
    }, function (err) {
      if (self.saving !== p) return;
      self.saving = null;
      if (err && err.code === 'agent-deleted') {
        // Deleted by the Handler while open here: stop, say so. A restore
        // (the document coming back) picks up from the saved copy.
        self.deleted = true;
        self.setStatus('Not saved: your Handler deleted this Agent');
        self.emit('deleted');
        return;
      }
      self.setStatus('Not saved yet — trying again');
      console.warn('agent-live: save failed, will retry', err && (err.code || err.message || err));
      self.retryLater();
    });
    this.saving = p;
    return p;
  };
  Session.prototype.retryLater = function () {
    var self = this;
    clearTimeout(this.retryTimer);
    var wait = RETRY[Math.min(this.retries, RETRY.length - 1)];
    this.retries++;
    this.retryTimer = setTimeout(function () { self.retryTimer = null; self.saveNow(); }, wait);
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
        if (self.deleted) { self.deleted = false; self.saveTimer = null; self.retryTimer = null; }
        self.char = Object.assign({}, self.char || {}, d);
        // A change of ours is waiting or on its way: its save merges this in
        // (even when the other device's state happens to equal ours).
        var pending = self.saveTimer || self.saving || self.retryTimer;
        if (!d.character_json || d.character_json === self.lastJson) { if (d.character_json && !pending) self.base = d.character_json; self.emit('doc'); return; }
        if (pending) return;
        var st = parse(d);
        if (!st) return;
        if (window.dgRules) window.dgRules.normalizeBio(st);
        self.state = st;
        self.lastJson = JSON.stringify(st);
        self.base = d.character_json;
        self.emit('remote');
      }, function () { /* offline: keep what we have */ });
    }).catch(function () { /* no Firebase here */ });
  };

  /* ── Edit mode ── */
  // The edit remembers what it started from, so saving it only changes
  // what was edited -- not whatever another device changed meanwhile.
  Session.prototype.beginEdit = function () { if (!this.edit && this.state) { this.edit = clone(this.state); this.editBase = JSON.stringify(this.state); } this.emit('edit'); return this.edit; };
  Session.prototype.cancelEdit = function () { this.edit = null; this.editBase = null; this.emit('edit'); };
  // Did the player change anything since Edit? Measured against the sheet
  // as Edit found it: a save landing meanwhile (an HP tap just before, a
  // Cell-mate's view refreshing) updates the live sheet, and used to make
  // Cancel ask "Throw away these edits?" with nothing edited.
  Session.prototype.editDirty = function () {
    if (!this.edit) return false;
    return JSON.stringify(this.edit) !== (this.editBase || JSON.stringify(this.state));
  };
  Session.prototype.commitEdit = function () {
    if (!this.edit) return Promise.resolve();
    this.state = this.edit;
    this.edit = null;
    if (this.editBase) this.base = this.editBase;
    this.editBase = null;
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
      s.base = s.lastJson;
    }
    return s;
  }

  // Leaving the page with an unsaved edit asks first; a play change still
  // waiting to save is sent now.
  // Back online: send whatever is still waiting.
  window.addEventListener('online', function () {
    Object.keys(sessions).forEach(function (k) { var s = sessions[k]; if (s.retryTimer) { s.retries = 0; s.saveNow(); } });
  });
  window.addEventListener('beforeunload', function (e) {
    var dirty = false;
    Object.keys(sessions).forEach(function (k) {
      var s = sessions[k];
      if (s.saveTimer || s.retryTimer) s.saveNow();
      if (s.editDirty()) dirty = true;
    });
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  window.dgAgentLive = { session: session, get: function (code) { return sessions[String(code || '').toUpperCase()] || null; } };
})();
