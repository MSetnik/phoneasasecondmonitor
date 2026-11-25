function quickMenu(el, getToken, touch, getChannel) {
  var grant = '', token = '', platform = '', actions = [], loaded = false, retryAt = 0;
  var session = null, noticeTimer, marker = '\u200b';
  var toolbar = el('toolbar'), typing = el('typing');
  var primary = false, shift = false;
  var buttons = toolbar.querySelectorAll('[data-action]');
  var keyBar = el('keyboardBar'), viewport = window.visualViewport;
  var passwordTyping = el('passwordTyping'), startPassword = el('startPassword');

  function positionKeys() {
    if (!session || !viewport) return;
    // Android's Back action can close the IME while leaving its receiver focused.
    if (session.initialWidth === viewport.width && session.initialHeight) {
      var covered = session.initialHeight - viewport.height;
      if (covered > 100) session.sawKeyboard = true;
      if (session.sawKeyboard && covered < 20 && !session.finishing) { finish(session); return; }
    } else {
      session.sawKeyboard = false;
      session.initialHeight = 0;
    }
    var stage = el('stage').getBoundingClientRect();
    keyBar.style.bottom = Math.max(0, stage.bottom - viewport.offsetTop - viewport.height) + 'px';
    keyBar.style.left = Math.max(0, viewport.offsetLeft - stage.left) + 'px';
    keyBar.style.right = Math.max(0, stage.right - viewport.offsetLeft - viewport.width) + 'px';
  }
  if (viewport) {
    viewport.addEventListener('resize', positionKeys);
    viewport.addEventListener('scroll', positionKeys);
    window.addEventListener('resize', positionKeys);
  }

  function notify(message, sticky) {
    clearTimeout(noticeTimer);
    if (session && message) { el('keyStatus').textContent = message; return; }
    el('feedback').textContent = message;
    el('feedback').hidden = !message;
    if (message && !sticky) noticeTimer = setTimeout(function () { notify(''); }, 5500);
  }
  function render() {
    Array.prototype.forEach.call(buttons, function (button) {
      button.hidden = actions.indexOf(button.dataset.action) < 0 ||
        (!!button.dataset.platform && button.dataset.platform !== platform);
      button.disabled = !grant;
    });
  }
  function discover() {
    var current = getToken();
    if (!current || (token === current && loaded) || Date.now() < retryAt) return;
    token = current;
    loaded = true;
    var req = new XMLHttpRequest();
    req.open('GET', '/capabilities');
    req.setRequestHeader('Authorization', 'Bearer ' + current);
    req.timeout = 3500;
    req.onloadend = function () {
      if (token !== current) return;
      if (req.status === 200) {
        try {
          var info = JSON.parse(req.responseText);
          platform = info.platform;
          actions = Array.isArray(info.actions) ? info.actions : [];
          render(); return;
        } catch (_) {}
      }
      loaded = false;
      retryAt = Date.now() + 3000;
    };
    req.send();
  }
  function open(show) {
    toolbar.dataset.open = String(show);
    toolbar.setAttribute('aria-hidden', String(!show));
    toolbar.toggleAttribute('inert', !show);
    el('shade').hidden = !show;
    el('menu').setAttribute('aria-expanded', String(show));
    if (show) {
      discover(); touch().armRight(false); notify('');
      if (session) finish(session);
    }
  }
  function call(s, command, done) {
    if (s.channel) { s.channel.keyboard(s.grant, command, done || function () {}); return; }
    var req = new XMLHttpRequest();
    req.open('POST', '/keyboard');
    req.setRequestHeader('Authorization', 'Bearer ' + s.token);
    req.setRequestHeader('X-Touch-Grant', s.grant);
    req.setRequestHeader('Content-Type', 'application/json');
    req.timeout = 3500;
    req.onloadend = function () { if (done) done(req); };
    req.send(JSON.stringify(command));
  }
  function detach(s) {
    if (session === s) {
      session = null;
      typing.blur(); typing.value = '';
      passwordTyping.blur(); passwordTyping.value = ''; passwordTyping.hidden = true;
      startPassword.hidden = true; typing.hidden = false;
      s.queue = []; s.value = s.ack = '';
      keyBar.hidden = true;
      el('typingDone').disabled = false;
      primary = shift = false;
    }
    if (s.lease) call(s, {action:'end', lease:s.lease});
  }
  function fail(s, req) {
    if (session !== s) return;
    detach(s);
    notify(req.status === 409 || req.status === 403 || req.status === 412 ? req.responseText :
      'Your computer did not confirm the input. Check the text on screen and reopen the keyboard.');
  }
  function supportsKeys() { return actions.indexOf('keyboardShortcuts') >= 0; }
  function buttonsState() {
    el('keyStrip').hidden = !supportsKeys();
    el('primaryKey').textContent = platform === 'windows' ? 'Ctrl' : '⌘';
    el('primaryKey').setAttribute('aria-label', platform === 'windows' ? 'Control' : 'Command');
    el('primaryKey').setAttribute('aria-pressed', String(primary));
    el('shiftKey').setAttribute('aria-pressed', String(shift));
    typing.setAttribute('autocapitalize', primary ? 'off' : 'sentences');
    typing.setAttribute('autocorrect', primary ? 'off' : 'on');
  }
  function resetBuffer(s) {
    s.queue = []; s.ack = ''; s.value = ''; s.step = 0;
    typing.value = marker; typing.setSelectionRange(1, 1);
  }
  function describe(s) {
    var mod = platform === 'windows' ? 'Ctrl' : '⌘';
    el('keyStatus').textContent = primary ? 'Hold ' + mod + ' and press A, C, F, S, V, X or Z. ⇧Z redoes the last action.' :
      (s.lease ? '' : 'Choose a shortcut key below, or tap a text field on your computer to type.');
  }
  function prepare(s) {
    s.checking = true;
    s.channel = s.channel || getChannel();
    call(s, {action:'begin'}, function (req) {
      s.checking = false;
      if ((req.status === 200 || (s.channel && req.status === 201)) && req.responseText) s.lease = req.responseText;
      if (session !== s) { if (s.lease) call(s, {action:'end',lease:s.lease}); return; }
      if (s.lease && req.status === 201) {
        if (s.finishing || s.reselect) { s.queue = []; pump(s); return; }
        s.password = true; s.chord = null; primary = shift = false;
        s.sawKeyboard = false; s.initialHeight = 0;
        resetBuffer(s); typing.value = ''; typing.blur(); typing.hidden = true;
        el('keyStrip').hidden = true; startPassword.hidden = false;
        el('keyStatus').textContent = 'A password field is selected on your PC.';
        return;
      }
      if (!s.lease) {
        if (req.status !== 409 || !supportsKeys()) { fail(s, req); return; }
        resetBuffer(s);
      }
      describe(s);
      if (!s.lease && req.responseText) el('keyStatus').textContent = req.responseText;
      pump(s);
    });
  }
  function targetChanged(action, message) {
    var s = session;
    if (!s) return;
    if (s.password && action === 'tap') { detach(s); return; }
    if (action === 'failed') {
      s.waitingKey = false; s.chord = null;
      if (message) el('keyStatus').textContent = message;
    } else {
      if (action === 'keyboardShortcut') s.waitingKey = false;
      s.reselect = true;
    }
    pump(s);
  }
  function pump(s) {
    if (session !== s || s.busy || s.checking || s.waitingKey) return;
    if (s.reselect && !s.finishing) {
      s.reselect = false; s.lease = ''; resetBuffer(s); prepare(s); return;
    }
    if (!s.lease || !s.queue.length) {
      if (s.chord) {
        s.waitingKey = true; var chord = s.chord; s.chord = null;
        touch().key(chord);
      } else if (s.finishing) detach(s);
      return;
    }
    var change = s.queue.shift(), command;
    if (s.password) {
      command = change;
    } else if (change.backspace) {
      command = {action:'backspace'};
    } else {
      if (s.ack === change.value) { pump(s); return; }
      var common = 0, value = change.value;
      while (common < s.ack.length && common < value.length && s.ack[common] === value[common]) common++;
      if (common && /[\uD800-\uDBFF]/.test(value.charAt(common - 1))) common--;
      command = {action:'edit', remove:s.ack.length - common, text:value.slice(common)};
    }
    command.lease = s.lease;
    command.step = ++s.step;
    s.busy = true;
    call(s, command, function (req) {
      if (session !== s) return;
      s.busy = false;
      if (req.status !== 204) {
        if (s.password || req.status !== 409 || !supportsKeys()) { fail(s, req); return; }
        s.lease = ''; resetBuffer(s); el('keyStatus').textContent = req.responseText;
        pump(s); return;
      }
      if (!s.password && !change.backspace) s.ack = change.value;
      pump(s);
    });
  }
  function record(s) {
    if (session !== s || s.finishing || s.password) return;
    var raw = typing.value, value = raw.charAt(0) === marker ? raw.slice(1) : raw;
    if (s.waitingKey || s.chord) { typing.value = marker; return; }
    if (primary) {
      if (value) letter(s, value, shift);
      typing.value = marker;
      return;
    }
    if (!s.checking && !s.lease) {
      typing.value = marker; describe(s); return;
    }
    if (value !== s.value) {
      var last = s.queue[s.queue.length - 1];
      if (last && !last.backspace) last.value = value;
      else s.queue.push({value:value});
      s.value = value;
    } else if (!raw) {
      s.queue.push({backspace:true});
    }
    if (raw.charAt(0) !== marker) {
      var caret = typing.selectionStart;
      typing.value = marker + value;
      typing.setSelectionRange(caret + 1, caret + 1);
    }
    pump(s);
  }
  function sendKey(s, name) {
    if (!supportsKeys() || s.finishing || s.waitingKey || s.chord) return;
    primary = shift = false;
    buttonsState();
    s.chord = name;
    pump(s);
  }
  function letter(s, key, shifted) {
    var letters = {a:'selectAll', c:'copy', f:'find', s:'save', v:'paste', x:'cut', z:'undo'};
    var k = key.toLowerCase();
    var name = shifted ? (k === 'z' ? 'redo' : null) : letters[k];
    if (name) sendKey(s, name);
    else el('keyStatus').textContent = 'Shortcuts support A, C, F, S, V, X, Z and ⇧Z.';
  }
  function finish(s) {
    if (s.finishing) return;
    typing.blur();
    passwordTyping.blur();
    if (!primary && !s.chord && !s.waitingKey) record(s);
    s.finishing = true;
    el('typingDone').disabled = true;
    pump(s);
  }
  function begin() {
    if (!grant || session) return;
    var s = {token:getToken(), grant:grant, lease:'', step:0, value:'', ack:'', busy:false, queue:[], finishing:false};
    if (viewport) { s.initialWidth = viewport.width; s.initialHeight = viewport.height; }
    session = s;
    open(false); notify('');
    buttonsState();
    keyBar.hidden = false;
    positionKeys();
    el('keyStatus').textContent = 'Checking the selected field…';
    typing.value = marker;
    // Keep the original tap as the iOS keyboard activation gesture, also in shortcut mode.
    typing.focus({preventScroll:true});
    typing.setSelectionRange(1, 1);
    prepare(s);
  }
  function setGrant(next) {
    if (next !== grant && session) detach(session);
    grant = next;
    notify(''); render();
  }
  function reset() {
    if (session) detach(session);
    token = ''; loaded = false; retryAt = 0;
    actions = []; platform = '';
    open(false); notify(''); render();
  }
  toolbar.addEventListener('click', function (event) {
    var button = event.target.closest('[data-action]');
    if (!grant || !button || button.hidden || button.disabled) return;
    var name = button.dataset.action;
    if (name === 'keyboard') { begin(); return; }
    open(false);
    if (name === 'rightClick') {
      touch().armRight(true);
      notify('Tap once where you want to right-click. Open the menu to cancel.', true);
    } else { touch().shortcut(name); }
  });
  typing.addEventListener('input', function () { if (session) record(session); });
  typing.addEventListener('blur', function () {
    var s = session;
    setTimeout(function () { if (s && session === s && !s.password && !s.finishing && document.activeElement !== typing) finish(s); }, 0);
  });
  startPassword.onclick = function () {
    var s = session;
    if (!s || !s.password || s.finishing) return;
    startPassword.hidden = true;
    passwordTyping.hidden = false;
    if (viewport) { s.initialWidth = viewport.width; s.initialHeight = viewport.height; }
    passwordTyping.value = marker;
    passwordTyping.focus({preventScroll:true});
    passwordTyping.setSelectionRange(1, 1);
    el('keyStatus').textContent = 'Typing into the password field on your PC.';
  };
  function passwordKey(action, text) {
    var s = session;
    if (!s || !s.password || s.finishing || !startPassword.hidden) return;
    s.queue.push(text === undefined ? {action:action} : {action:action,text:text});
    pump(s);
  }
  passwordTyping.addEventListener('beforeinput', function (e) {
    if (e.inputType === 'deleteContentBackward' && e.cancelable && !e.isComposing) {
      e.preventDefault(); passwordKey('passwordDelete');
    }
  });
  function readPassword(e) {
    if (e.isComposing) return;
    var raw = passwordTyping.value;
    var text = raw.charAt(0) === marker ? raw.slice(1) : raw;
    passwordTyping.value = marker; passwordTyping.setSelectionRange(1, 1);
    if (text) passwordKey('passwordInsert', text);
    else if (!raw || e.inputType === 'deleteContentBackward') passwordKey('passwordDelete');
  }
  passwordTyping.addEventListener('input', readPassword);
  passwordTyping.addEventListener('compositionend', function () {
    var s = session;
    setTimeout(function () {
      if (s && session === s && passwordTyping.value !== marker && passwordTyping.value) readPassword({});
    }, 0);
  });
  passwordTyping.addEventListener('keydown', function (e) {
    if (session && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault(); passwordKey('passwordEnter'); finish(session);
    }
  });
  passwordTyping.addEventListener('blur', function () {
    var s = session;
    setTimeout(function () { if (s && session === s && s.password && !s.finishing && document.activeElement !== passwordTyping) finish(s); }, 0);
  });
  var strip = el('keyStrip');
  strip.addEventListener('pointerdown', function (e) { e.preventDefault(); });
  strip.addEventListener('mousedown', function (e) { e.preventDefault(); });
  strip.addEventListener('click', function (e) {
    var s = session, button = e.target.closest('button');
    if (!s || !button || !supportsKeys()) return;
    typing.focus({preventScroll:true});
    if (button.id === 'primaryKey' || button.id === 'shiftKey') {
      if (button.id === 'primaryKey') {
        primary = !primary;
        if (!primary) shift = false;
      } else { shift = !shift; }
      buttonsState(); describe(s);
      typing.value = marker + (primary ? '' : s.value);
      typing.setSelectionRange(typing.value.length, typing.value.length);
    } else {
      sendKey(s, button.dataset.key === 'tab' && shift ? 'backTab' : button.dataset.key);
    }
  });
  typing.addEventListener('compositionend', function () { if (session) record(session); });
  typing.addEventListener('keydown', function (e) {
    if (session && supportsKeys() && !e.isComposing && (e.metaKey || e.ctrlKey) && e.key.length === 1) {
      e.preventDefault(); letter(session, e.key, e.shiftKey); return;
    }
    if (session && !primary && !session.waitingKey && (session.lease || session.checking) && !e.isComposing && e.key === 'Backspace' && !session.value && typing.value === marker) {
      e.preventDefault(); session.queue.push({backspace:true}); pump(session);
    }
  });
  el('typingDone').onclick = function () { if (session) finish(session); };
  el('menu').onclick = function () { open(toolbar.dataset.open !== 'true'); };
  el('shade').onclick = function () { open(false); el('menu').focus(); };
  window.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (session) finish(session);
    else { open(false); touch().armRight(false); notify(''); el('menu').focus(); }
  });
  function suspend() {
    if (session) detach(session);
    touch().armRight(false); open(false); notify('');
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) suspend(); });
  window.addEventListener('pagehide', suspend);
  return {open:open, setGrant:setGrant, reset:reset, discover:discover, notify:notify,
    channelClosed:function (channel) {
      if (session && session.channel === channel) {
        detach(session);
        notify('Keyboard connection ended. Check the text on your PC.');
      }
    },
    targetChanged:targetChanged, supports:function (name) { return actions.indexOf(name) >= 0; }, typing:function () { return !!session; }};
}
