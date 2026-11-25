// A receive-only LAN peer. Browsers without WebRTC continue using the JPEG viewer.
(function () {
  'use strict';
  if (!window.RTCPeerConnection || !window.fetch) return;

  var intervals = [], previous = 0, refreshHz = 60;
  function measureRefresh(time) {
    var delta = time - previous;
    previous = time;
    if (delta >= 5 && delta <= 50) intervals.push(delta);
    if (intervals.length >= 10) {
      var sorted = intervals.slice().sort(function (a, b) { return a - b; });
      refreshHz = Math.round(1000 / sorted[Math.floor(sorted.length / 3)]);
    }
    if (intervals.length < 60) requestAnimationFrame(measureRefresh);
  }
  requestAnimationFrame(measureRefresh);

  function start(token, viewport, onLive, onEnd, useVP8, onTouchGrant, onInputClosed, onDemoTime) {
    var movie = document.getElementById('movie'), info = document.getElementById('rate');
    var pc, id, closed = false, live = false, frameCallback, watchdog, tick, disconnectTimer;
    var firstCount, firstTime, rendered = null, sent = null, target = null, codec = 'Video';
    var detail = 0, badSamples = 0, goodSamples = 0, frozenSamples = 0, previousStats;
    var frameAge = null, lastFrameTime = 0, roundTrip = null, bufferDelay = null;
    var inputChannel, nextInputID = 0, pendingInputs = new Map();
    function closeInput() {
      var hadChannel = !!inputChannel;
      inputChannel = null;
      pendingInputs.forEach(function (done) { done({status:0}); });
      pendingInputs.clear();
      if (hadChannel) onInputClosed(handle);
    }
    function input(kind, grant, command, done) {
      if (!inputChannel || inputChannel.readyState !== 'open') { done({status:0}); return; }
      var id = ++nextInputID;
      var timer = setTimeout(function () { complete({status:0}); }, kind === 'touch' ? 1800 : 3500);
      function complete(reply) { clearTimeout(timer); pendingInputs.delete(id); done(reply); }
      pendingInputs.set(id, complete);
      try { inputChannel.send(JSON.stringify({kind:kind, id:id, token:token, grant:grant, body:JSON.stringify(command)})); }
      catch (_) { complete({status:0}); }
    }
    function label() {
      var parts = [codec];
      if (sent !== null) parts.push(sent + ' sent');
      if (rendered !== null) parts.push(rendered + ' displayed FPS');
      if (target) parts.push('target ' + target);
      if (roundTrip !== null) parts.push('RTT ' + Math.round(roundTrip) + ' ms');
      if (frameAge !== null && performance.now() - lastFrameTime < 1500) parts.push('picture ≈' + Math.round(frameAge) + ' ms');
      else if (bufferDelay !== null) parts.push('buffer ' + Math.round(bufferDelay) + ' ms');
      if (movie.videoWidth) parts.push(movie.videoWidth + ' × ' + movie.videoHeight + ' px');
      info.textContent = parts.join(' · ');
    }
    async function call(method, path, body) {
      var headers = {Authorization: 'Bearer ' + token, 'X-Viewport': viewport()};
      if (id) headers['X-Video-ID'] = id;
      if (path === '/video-status') headers['X-Video-Detail'] = String(detail);
      var abort = window.AbortController && new AbortController();
      var timer = abort && setTimeout(function () { abort.abort(); }, 5500);
      try {
        var res = await fetch(path, {method: method, headers: headers, body: body, cache: 'no-store', signal: abort ? abort.signal : undefined});
        if (!res.ok) throw Error('Video ' + res.status);
        return res;
      } finally { clearTimeout(timer); }
    }
    function close(notify) {
      if (closed) return;
      closed = true;
      closeInput();
      clearTimeout(watchdog); clearTimeout(tick); clearTimeout(disconnectTimer);
      if (frameCallback && movie.cancelVideoFrameCallback) movie.cancelVideoFrameCallback(frameCallback);
      movie.onloadeddata = null;
      if (pc) { pc.onconnectionstatechange = pc.oniceconnectionstatechange = pc.ontrack = null; pc.close(); }
      movie.srcObject = null;
      movie.hidden = true;
      movie.style.opacity = '0';
      if (id) call('POST', '/video-stop').catch(function () {});
      if (notify) onEnd(!live && codec === 'H.264');
    }
    function visibleFrame() {
      if (closed || live) return;
      live = true;
      clearTimeout(watchdog);
      movie.style.opacity = '1';
      label();
      onLive();
    }
    function countFrame(time, meta) {
      if (closed) return;
      visibleFrame();
      var age = meta.expectedDisplayTime - meta.captureTime;
      if (Number.isFinite(age) && age >= 0 && age < 10000) {
        frameAge = frameAge === null || time - lastFrameTime > 1000 ? age : frameAge * 0.9 + age * 0.1;
      } else { frameAge = null; }
      lastFrameTime = time;
      if (firstTime == null) { firstTime = time; firstCount = meta.presentedFrames; }
      if (time - firstTime >= 900) {
        rendered = Math.round(1000 * (meta.presentedFrames - firstCount) / (time - firstTime));
        firstTime = time; firstCount = meta.presentedFrames;
        label();
      }
      frameCallback = movie.requestVideoFrameCallback(countFrame);
    }
    async function measureVideo(contentMoving) {
      var report = await pc.getStats(), video, selected, nominated;
      if (closed) return;
      report.forEach(function (s) {
        if (s.type === 'inbound-rtp' && (s.kind || s.mediaType) === 'video') video = s;
        if (s.type === 'transport' && s.selectedCandidatePairId) selected = report.get(s.selectedCandidatePairId);
        if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') nominated = s;
      });
      var pair = selected || nominated;
      roundTrip = pair && Number.isFinite(pair.currentRoundTripTime) ? 1000 * pair.currentRoundTripTime : null;
      var old = previousStats;
      previousStats = video;
      bufferDelay = null;
      if (!video || !old || video.id !== old.id || document.hidden) { badSamples = goodSamples = frozenSamples = 0; return; }
      var seconds = (video.timestamp - old.timestamp) / 1000;
      var decoded = video.framesDecoded - old.framesDecoded;
      var emitted = video.jitterBufferEmittedCount - old.jitterBufferEmittedCount;
      var buffered = 1000 * (video.jitterBufferDelay - old.jitterBufferDelay) / emitted;
      if (emitted > 0 && Number.isFinite(buffered)) bufferDelay = Math.max(0, buffered);
      // Idle refresh frames can restore sharp text once the receiver has caught up.
      if ((!contentMoving && detail === 0) || !(seconds > 0 && seconds < 3) || !(decoded >= 5 * seconds || sent >= 10)) {
        badSamples = goodSamples = frozenSamples = 0; return;
      }
      frozenSamples = contentMoving && live && sent >= 10 && decoded === 0 ? frozenSamples + 1 : 0;
      if (frozenSamples >= 5) { close(true); return; }
      var received = video.packetsReceived - old.packetsReceived;
      var lost = Math.max(0, video.packetsLost - old.packetsLost);
      var loss = received + lost >= 20 ? lost / (received + lost) : 0;
      var decodeMs = decoded > 0 ? 1000 * (video.totalDecodeTime - old.totalDecodeTime) / decoded : 0;
      var freshAge = frameAge !== null && performance.now() - lastFrameTime < 1000;
      var excessAge = freshAge && roundTrip !== null ? frameAge - roundTrip / 2 : null;
      var pressured = (bufferDelay !== null && bufferDelay > 60) || loss > 0.035 ||
        decodeMs > 950 / target || (excessAge !== null && excessAge > 100) || (sent >= 10 && decoded === 0);
      var healthy = decoded >= 5 * seconds && (bufferDelay === null || bufferDelay < 38) && loss < 0.01 &&
        !(decodeMs > 750 / target) && (excessAge === null || excessAge < 70);
      var severe = bufferDelay > 150 || excessAge > 180 || loss > 0.12;
      badSamples = !contentMoving ? 0 : severe ? 2 : (pressured ? badSamples + 1 : 0);
      goodSamples = healthy ? goodSamples + 1 : 0;
      if ((badSamples >= 2 && detail < 2) || (goodSamples >= 10 && detail > 0)) {
        detail += badSamples >= 2 ? 1 : -1;
        badSamples = goodSamples = 0;
      }
    }
    async function heartbeat() {
      if (closed) return;
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') { close(true); return; }
      try {
        var response = await call('GET', '/video-status');
        var values = (await response.text()).split(',').map(Number);
        if (closed) return;
        onTouchGrant(response.headers.get('X-Touch-Grant'));
        if (onDemoTime) onDemoTime(response.headers.get('X-Demo-Remaining'));
        target = values[0]; sent = values[1] >= 0 ? values[1] : null;
        try { await measureVideo(values[2] !== 0); } catch (_) { /* Statistics are optional on older browsers. */ }
        if (closed) return;
        if (firstTime != null && performance.now() - firstTime > 2000) rendered = 0;
        label();
        tick = setTimeout(heartbeat, 900);
      } catch (_) { close(true); }
    }
    async function connect() {
      var startReply = await call('POST', '/video-offer');
      var session = await startReply.json();
      id = session.id;
      target = Number(session.fps);
      if (closed) { call('POST', '/video-stop').catch(function () {}); return; }
      var offer;
      while (!closed) {
        var reply = await call('GET', '/video-offer');
        if (reply.status === 200) { offer = await reply.text(); break; }
        await new Promise(function (resolve) { setTimeout(resolve, 100); });
      }
      if (closed) return;
      pc = new RTCPeerConnection({iceServers: []});
      pc.ondatachannel = function (event) {
        var channel = event.channel;
        // The existing wire label is shared with keyboard-only viewers.
        if (closed || inputChannel || channel.label !== 'keyboard') { channel.close(); return; }
        inputChannel = channel;
        channel.onclose = closeInput;
        channel.onmessage = function (event) {
          var reply;
          try { reply = JSON.parse(event.data); } catch (_) { return; }
          var complete = pendingInputs.get(reply.id);
          if (complete) complete(reply);
        };
      };
      pc.ontrack = function (event) {
        movie.muted = true;
        movie.hidden = false;
        movie.style.opacity = '0';
        if ('jitterBufferTarget' in event.receiver) {
          try { event.receiver.jitterBufferTarget = 0; } catch (_) {}
        }
        movie.srcObject = event.streams[0] || new MediaStream([event.track]);
        movie.onloadeddata = visibleFrame;
        if (movie.requestVideoFrameCallback) frameCallback = movie.requestVideoFrameCallback(countFrame);
        movie.play().catch(function () { close(true); });
      };
      function connectionChanged() {
        var state = pc.connectionState || pc.iceConnectionState;
        clearTimeout(disconnectTimer);
        if (state === 'failed' || state === 'closed') close(true);
        if (state === 'disconnected') disconnectTimer = setTimeout(function () { close(true); }, 3000);
      }
      pc.onconnectionstatechange = pc.oniceconnectionstatechange = connectionChanged;
      await pc.setRemoteDescription({type: 'offer', sdp: offer});
      // Chrome often signals its default H.264 level for 720p/30. Only advertise a
      // higher receive level after checking the actual decoder at our maximum size.
      var highLevel = false;
      if (!useVP8 && navigator.mediaCapabilities && offer.toLowerCase().includes('42e033')) {
        try {
          var support = await navigator.mediaCapabilities.decodingInfo({type: 'file', video: {
            contentType: 'video/mp4; codecs="avc1.42E033"', width: Number(session.width) || 1280, height: Number(session.height) || 1280,
            bitrate: 24000000, framerate: target
          }});
          highLevel = support.supported && support.smooth;
        } catch (_) {}
      }
      var transceiver = pc.getTransceivers()[0];
      if (transceiver && transceiver.setCodecPreferences && window.RTCRtpReceiver && RTCRtpReceiver.getCapabilities) {
        var codecs = RTCRtpReceiver.getCapabilities('video').codecs;
        var preferred = codecs.filter(function (c) {
          return highLevel ? c.mimeType.toLowerCase() === 'video/h264' : c.mimeType.toLowerCase() === 'video/vp8';
        });
        if (preferred.length) transceiver.setCodecPreferences(preferred);
      }
      var answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      for (var i = 0; i < 40 && !closed && pc.iceGatheringState !== 'complete'; i++) {
        await new Promise(function (resolve) { setTimeout(resolve, 50); });
      }
      if (closed) return;
      var sdp = pc.localDescription.sdp;
      if (highLevel) sdp = sdp.replace(/^a=fmtp:[^\r\n]+/gm, function (format) {
        return format.includes('level-asymmetry-allowed=1') ?
          format.replace(/profile-level-id=42e0[0-9a-f]{2}/i, 'profile-level-id=42e033') : format;
      });
      codec = /a=rtpmap:\d+ H264\//i.test(sdp) ? 'H.264' : 'VP8';
      await call('POST', '/video-answer', sdp);
      heartbeat();
    }
    watchdog = setTimeout(function () { close(true); }, 12000);
    var handle = {stop: function () { close(false); }, keyboard:function (grant, command, done) { input('keyboard', grant, command, done); },
      touch:function (grant, command, done) { input('touch', grant, command, done); },
      // Allow a high-refresh gesture to continue across a slow return trip. When
      // outgoing bytes accumulate, let controls.js merge movement until a reply arrives.
      touchWindow:function () { return inputChannel && inputChannel.bufferedAmount < 2048 ? 16 : 1; },
      inputReady:function () { return !!inputChannel && inputChannel.readyState === 'open'; }};
    connect().catch(function () { close(true); });
    return handle;
  }
  window.GalaxyVideo = {start: start, refreshHz: function () { return refreshHz; }};
}());
