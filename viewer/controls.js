function displayAwake(movie, retry) {
  var sharing = false, generation = 0, sentinel = null, shown = true;
  function visible() { return sharing && shown && !document.hidden; }
  function stopMedia() { movie.pause(); movie.hidden = true; }
  function media(turn) {
    if (turn !== generation || !visible()) return;
    movie.hidden = false;
    movie.muted = true;
    var started = movie.play();
    if (started && started.catch) started.catch(function () {
      if (turn === generation && visible()) retry.hidden = false;
    });
  }
  function sync() {
    var turn = ++generation;
    retry.hidden = true;
    if (sentinel) { sentinel.release().catch(function () {}); sentinel = null; }
    stopMedia();
    if (!visible()) return;
    if (!navigator.wakeLock || !navigator.wakeLock.request) { media(turn); return; }
    navigator.wakeLock.request('screen').then(function (lock) {
      if (turn !== generation || !visible()) { lock.release().catch(function () {}); return; }
      sentinel = lock;
      lock.addEventListener('release', function () {
        if (sentinel === lock) { sentinel = null; media(turn); }
      });
    }).catch(function () { media(turn); });
  }
  retry.onclick = sync;
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', function () { shown = false; sync(); });
  window.addEventListener('pageshow', function () { shown = true; sync(); });
  return function (active) {
    if (sharing !== active) { sharing = active; sync(); }
  };
}

function displayTouch(surface, currentImage, getToken, hint, onGrant, notify, supports, onTargetChange, inputChannel) {
  var grant = '', sequence = Date.now() * 1000, queue = [], pointer = null;
  var inFlight = 0, generation = 0, channel = null;
  var motionTail = null;
  var contact = surface.querySelector('#contact');
  var hold, dragHeartbeat, rightClick = false;
  function enable(value) {
    value = window.PointerEvent ? (value || '') : '';
    if (value === grant) return;
    clearPointer();
    resetDelivery();
    rightClick = false;
    grant = value;
    surface.classList.toggle('interactive', !!grant);
    hint.textContent = grant ? 'Hold and release to right-click. Hold and drag to move.' : 'Enable touch control on your computer.';
    onGrant(grant);
  }
  function resetDelivery() {
    generation++;
    inFlight = 0; channel = null; queue = []; motionTail = null;
  }
  function postHTTP(command, done) {
    var req = new XMLHttpRequest();
    req.open('POST', '/touch');
    req.setRequestHeader('Authorization', 'Bearer ' + getToken());
    req.setRequestHeader('X-Touch-Grant', grant);
    req.setRequestHeader('Content-Type', 'application/json');
    req.timeout = 1800;
    req.onloadend = function () { done(req); };
    req.send(JSON.stringify(command));
  }
  function pump() {
    if (!grant || !queue.length) return;
    // Ordered WebRTC messages can be sent before the preceding reply arrives.
    // Drain one transport before switching so a late move can't overtake a release.
    if (!inFlight) channel = inputChannel();
    while (queue.length && inFlight < (channel ? channel.touchWindow() : 1)) {
      send(queue.shift());
    }
  }
  function send(command) {
    var turn = generation;
    command.sequence = ++sequence;
    inFlight++;
    function complete(reply) {
      if (turn !== generation) return;
      inFlight--;
      if (reply.status !== 204) {
        clearPointer();
        resetDelivery();
        if (reply.status === 403) enable('');
        if (command.action !== 'cancel') {
          var message = reply.status === 409 && reply.responseText || 'Command not confirmed. Check the connection and touch permission.';
          onTargetChange('failed', message); notify(message);
          if (grant) enqueue('cancel', {x:0,y:0});
        }
        return;
      }
      if (command.action === 'tap' || command.action === 'keyboardShortcut') onTargetChange(command.action);
      pump();
    }
    if (channel) channel.touch(grant, command, complete); else postHTTP(command, complete);
  }
  function enqueue(action, p, dx, dy) {
    if (!grant) return;
    var last = queue[queue.length - 1];
    if (last && last === motionTail && last.action === action && (action === 'move' || action === 'scroll')) {
      last.x = p.x; last.y = p.y;
      if (action === 'scroll') {
        last.dx = Math.max(-2, Math.min(2, last.dx + dx));
        last.dy = Math.max(-2, Math.min(2, last.dy + dy));
      }
    } else {
      motionTail = {action: action, x: p.x, y: p.y, dx: dx, dy: dy};
      queue.push(motionTail);
    }
    pump();
  }
  function position(event, clamp) {
    var image = currentImage(), rect = surface.getBoundingClientRect();
    var w = image.videoWidth || image.naturalWidth, h = image.videoHeight || image.naturalHeight;
    if (!(w && h && rect.width && rect.height)) return null;
    var scale = Math.min(rect.width / w, rect.height / h);
    var x = (event.clientX - rect.left - (rect.width - w * scale) / 2) / (w * scale);
    var y = (event.clientY - rect.top - (rect.height - h * scale) / 2) / (h * scale);
    if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return {x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y))};
  }
  function clearPointer() {
    clearTimeout(hold); clearInterval(dragHeartbeat);
    motionTail = null;
    contact.hidden = true;
    var id = pointer && pointer.id;
    pointer = null;
    if (id != null && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  }
  function cancel() {
    if (pointer && pointer.mode === 'drag') enqueue('cancel', pointer.last);
    clearPointer();
  }
  function startDrag() {
    pointer.mode = 'drag';
    enqueue('down', pointer.start);
    dragHeartbeat = setInterval(function () { if (pointer) enqueue('move', pointer.last); }, 900);
  }
  function markContact(e) {
    contact.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
  }
  surface.addEventListener('pointerdown', function (e) {
    if (!grant || pointer || !e.isPrimary || e.button !== 0) return;
    var p = position(e, false);
    if (!p) return;
    e.preventDefault();
    surface.setPointerCapture(e.pointerId);
    pointer = {id: e.pointerId, start: p, last: p, px: e.clientX, py: e.clientY, mode: 'tap'};
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      markContact(e);
      contact.hidden = false;
    }
    if (rightClick) {
      rightClick = false;
      notify('');
      pointer.mode = 'consumed';
      enqueue('rightClick', p);
      return;
    }
    // Position the real cursor on contact. Only a completed tap can click.
    if (!contact.hidden && supports('point') && inputChannel()) enqueue('point', p);
    hold = setTimeout(function () {
      if (!pointer || pointer.mode !== 'tap') return;
      if (supports('rightClick')) pointer.mode = 'held';
      else startDrag();
    }, 420);
  });
  function move(e) {
    if (pointer.mode === 'consumed') return;
    if (!contact.hidden) markContact(e);
    var p = position(e, true);
    if (!p) { cancel(); return; }
    if (pointer.mode === 'tap' || pointer.mode === 'held') {
      if (Math.hypot(e.clientX - pointer.px, e.clientY - pointer.py) < 7) return;
      clearTimeout(hold);
      if (pointer.mode === 'held') {
        startDrag();
      } else { pointer.mode = 'scroll'; }
    }
    var dx = p.x - pointer.last.x, dy = p.y - pointer.last.y;
    if (dx || dy) {
      if (pointer.mode === 'drag') enqueue('move', p);
      else enqueue('scroll', pointer.start, dx, dy);
    }
    pointer.last = p;
  }
  surface.addEventListener('pointermove', function (e) {
    if (pointer && e.pointerId === pointer.id) move(e);
  });
  surface.addEventListener('pointerup', function (e) {
    if (!pointer || e.pointerId !== pointer.id) return;
    move(e);
    if (!pointer) return;
    if (pointer.mode === 'tap') enqueue('tap', pointer.start);
    if (pointer.mode === 'held') enqueue('rightClick', pointer.start);
    if (pointer.mode === 'drag') enqueue('up', pointer.last);
    clearPointer();
  });
  ['pointercancel','lostpointercapture'].forEach(function (name) {
    surface.addEventListener(name, function (e) { if (pointer && e.pointerId === pointer.id) cancel(); });
  });
  surface.addEventListener('contextmenu', function (e) { if (grant) e.preventDefault(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden) cancel(); });
  window.addEventListener('pagehide', cancel);
  window.addEventListener('resize', cancel);
  return {enable: enable, cancel: cancel,
    armRight: function (active) { rightClick = !!grant && active; },
    key: function (shortcut) {
      if (grant) { queue.push({action:'keyboardShortcut', shortcut:shortcut, x:0.5, y:0.5}); pump(); }
    },
    shortcut: function (name) { enqueue(name, {x: 0.5, y: 0.5}); }};
}
