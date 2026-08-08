/*
 * app.js — prompteur vidéo mobile.
 * Caméra (getUserMedia) + texte défilant. Aucun envoi réseau,
 * aucune dépendance externe. Le texte reste sur l'appareil (localStorage).
 */
(function () {
  'use strict';

  var core = window.PrompterCore;
  if (!core) {
    throw new Error('PrompterCore manquant');
  }

  var STORAGE_TEXT_KEY = 'teleprompter.text.v1';
  var STORAGE_SETTINGS_KEY = 'teleprompter.settings.v1';

  var state = {
    running: false,
    hasStarted: false,
    startedAt: 0,
    accumulatedMs: 0,
    rafId: null,
    countdownTimer: null,
    countdownValue: 3,
    paragraphs: [],
    maxScroll: 0,
    speed: core.DEFAULT_SPEED,
    fontSize: core.DEFAULT_FONT,
    opacity: core.DEFAULT_OPACITY,
    mirror: true,
    camStream: null
  };

  var els = {
    screen: document.getElementById('screen'),
    video: document.getElementById('cam'),
    textLayer: document.getElementById('textLayer'),
    textInner: document.getElementById('textInner'),
    topbar: document.getElementById('topbar'),
    elapsed: document.getElementById('elapsed'),
    btnFullscreen: document.getElementById('btnFullscreen'),
    btnToggleControls: document.getElementById('btnToggleControls'),
    controls: document.getElementById('controls'),
    btnPlay: document.getElementById('btnPlay'),
    btnReset: document.getElementById('btnReset'),
    speedSlider: document.getElementById('speedSlider'),
    speedValue: document.getElementById('speedValue'),
    fontSlider: document.getElementById('fontSlider'),
    fontValue: document.getElementById('fontValue'),
    opacitySlider: document.getElementById('opacitySlider'),
    mirrorToggle: document.getElementById('mirrorToggle'),
    btnEditText: document.getElementById('btnEditText'),
    overlay: document.getElementById('overlay'),
    modal: document.getElementById('modal'),
    textInput: document.getElementById('textInput'),
    textStats: document.getElementById('textStats'),
    btnSaveText: document.getElementById('btnSaveText'),
    btnCancelText: document.getElementById('btnCancelText'),
    camError: document.getElementById('camError')
  };

  function loadSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_SETTINGS_KEY);
      if (!raw) {
        return;
      }
      var s = JSON.parse(raw);
      state.speed = core.clampSpeed(s.speed);
      state.fontSize = core.clampFontSize(s.fontSize);
      state.opacity = core.clampOpacity(s.opacity);
      state.mirror = s.mirror !== false;
    } catch (e) {
      // stockage indisponible : valeurs par défaut conservées
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify({
        speed: state.speed,
        fontSize: state.fontSize,
        opacity: state.opacity,
        mirror: state.mirror
      }));
    } catch (e) {
      // stockage indisponible : rien à faire
    }
  }

  function loadText() {
    try {
      var saved = localStorage.getItem(STORAGE_TEXT_KEY);
      if (saved) {
        return saved;
      }
    } catch (e) {
      // stockage indisponible
    }
    return 'Exemple — remplacez ce texte par votre script.\n\n' +
      'Bonjour et bienvenue. Ceci est un texte d\'exemple synthétique ' +
      'pour vérifier le défilement du prompteur.';
  }

  function saveText(text) {
    try {
      localStorage.setItem(STORAGE_TEXT_KEY, text);
    } catch (e) {
      // stockage indisponible : texte conservé en mémoire uniquement
    }
  }

  function applySettings() {
    els.textInner.style.fontSize = state.fontSize + 'px';
    els.textInner.style.opacity = String(state.opacity);
    els.speedSlider.value = String(state.speed);
    els.speedValue.textContent = state.speed + ' px/s';
    els.fontSlider.value = String(state.fontSize);
    els.fontValue.textContent = state.fontSize + ' px';
    els.opacitySlider.value = String(state.opacity);
    els.mirrorToggle.checked = state.mirror;
    els.screen.classList.toggle('mirror', state.mirror);
    saveSettings();
  }

  function renderText() {
    var container = els.textInner;
    container.textContent = '';
    state.paragraphs.forEach(function (p) {
      var node = document.createElement('p');
      node.textContent = p;
      container.appendChild(node);
    });
    measureScroll();
    resetScroll();
  }

  function measureScroll() {
    state.maxScroll = Math.max(0, els.textInner.scrollHeight - els.textLayer.clientHeight);
  }

  function resetScroll() {
    state.running = false;
    state.hasStarted = false;
    state.accumulatedMs = 0;
    cancelRaf();
    els.textInner.style.transform = 'translateY(0px)';
    els.elapsed.textContent = '00:00';
    updatePlayButton();
  }

  function cancelRaf() {
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function updatePlayButton() {
    els.btnPlay.textContent = state.running ? '⏸' : '▶';
  }

  function startScroll() {
    state.startedAt = performance.now();
    state.running = true;
    updatePlayButton();
    tick();
  }

  function pauseScroll() {
    if (!state.running) {
      return;
    }
    state.accumulatedMs += performance.now() - state.startedAt;
    state.running = false;
    cancelRaf();
    updatePlayButton();
  }

  function tick() {
    if (!state.running) {
      return;
    }
    var elapsedMs = state.accumulatedMs + (performance.now() - state.startedAt);
    var pos = core.scrollPositionAt(elapsedMs, state.speed, state.maxScroll);
    els.textInner.style.transform = 'translateY(-' + pos + 'px)';
    els.elapsed.textContent = core.formatElapsed(elapsedMs);
    if (core.isAtEnd(pos, state.maxScroll)) {
      state.running = false;
      updatePlayButton();
      showOverlay('Fin du texte', 1800);
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function beginCountdown() {
    var remaining = state.countdownValue;
    if (remaining <= 0) {
      startScroll();
      return;
    }
    showOverlay(String(remaining), 900);
    state.countdownTimer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
        hideOverlay();
        startScroll();
      } else {
        showOverlay(String(remaining), 900);
      }
    }, 1000);
  }

  function togglePlay() {
    if (state.running) {
      pauseScroll();
      return;
    }
    if (core.isAtEnd(core.scrollPositionAt(state.accumulatedMs, state.speed, state.maxScroll), state.maxScroll)) {
      state.accumulatedMs = 0;
    }
    if (!state.hasStarted) {
      state.hasStarted = true;
      beginCountdown();
    } else {
      startScroll();
    }
  }

  function showOverlay(text, durationMs) {
    els.overlay.textContent = text;
    els.overlay.classList.add('visible');
    clearTimeout(showOverlay._t);
    if (durationMs) {
      showOverlay._t = setTimeout(hideOverlay, durationMs);
    }
  }

  function hideOverlay() {
    els.overlay.classList.remove('visible');
  }

  function startCamera() {
    if (state.camStream) {
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showCameraError('Caméra non supportée par ce navigateur. Utilisez Safari ou Chrome récent.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      state.camStream = stream;
      els.video.srcObject = stream;
      els.video.classList.add('active');
      els.video.play().catch(function () { /* lecture différée */ });
      hideCameraError();
    }).catch(function (err) {
      var message = 'Impossible de démarrer la caméra.';
      if (err && err.name === 'NotAllowedError') {
        message = 'Caméra refusée. Autorisez la caméra dans les réglages du navigateur.';
      } else if (err && err.name === 'NotFoundError') {
        message = 'Aucune caméra détectée sur cet appareil.';
      } else if (err && err.name === 'NotReadableError') {
        message = 'Caméra déjà utilisée par une autre application.';
      } else if (err && err.name === 'SecurityError') {
        message = 'La caméra exige une connexion sécurisée (HTTPS). GitHub Pages la fournit.';
      }
      showCameraError(message);
    });
  }

  function stopCamera() {
    if (state.camStream) {
      state.camStream.getTracks().forEach(function (t) { t.stop(); });
      state.camStream = null;
    }
    els.video.classList.remove('active');
  }

  function showCameraError(message) {
    els.camError.textContent = message;
    els.camError.classList.add('visible');
  }

  function hideCameraError() {
    els.camError.classList.remove('visible');
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function () {});
    } else {
      document.documentElement.requestFullscreen().catch(function () {});
    }
  }

  function toggleControlsVisibility() {
    els.screen.classList.toggle('controls-hidden');
  }

  function openModal() {
    els.textInput.value = state.paragraphs.join('\n');
    updateTextStats();
    els.modal.classList.add('visible');
    els.textInput.focus();
  }

  function closeModal() {
    els.modal.classList.remove('visible');
  }

  function saveModal() {
    state.paragraphs = core.buildParagraphs(els.textInput.value);
    saveText(els.textInput.value);
    renderText();
    closeModal();
  }

  function updateTextStats() {
    var paragraphs = core.buildParagraphs(els.textInput.value);
    els.textStats.textContent = paragraphs.length + ' paragraphe(s), ' +
      core.countWords(paragraphs) + ' mot(s). Le texte reste sur cet appareil.';
  }

  function bindEvents() {
    els.btnPlay.addEventListener('click', togglePlay);
    els.btnReset.addEventListener('click', function () {
      resetScroll();
      hideOverlay();
    });
    els.speedSlider.addEventListener('input', function () {
      state.speed = core.clampSpeed(Number(els.speedSlider.value));
      els.speedValue.textContent = state.speed + ' px/s';
      saveSettings();
    });
    els.fontSlider.addEventListener('input', function () {
      state.fontSize = core.clampFontSize(Number(els.fontSlider.value));
      els.fontValue.textContent = state.fontSize + ' px';
      els.textInner.style.fontSize = state.fontSize + 'px';
      saveSettings();
      measureScroll();
    });
    els.opacitySlider.addEventListener('input', function () {
      state.opacity = core.clampOpacity(Number(els.opacitySlider.value));
      els.textInner.style.opacity = String(state.opacity);
      saveSettings();
    });
    els.mirrorToggle.addEventListener('change', function () {
      state.mirror = els.mirrorToggle.checked;
      els.screen.classList.toggle('mirror', state.mirror);
      saveSettings();
    });
    els.btnEditText.addEventListener('click', openModal);
    els.btnSaveText.addEventListener('click', saveModal);
    els.btnCancelText.addEventListener('click', closeModal);
    els.textInput.addEventListener('input', updateTextStats);
    els.btnFullscreen.addEventListener('click', toggleFullscreen);
    els.btnToggleControls.addEventListener('click', toggleControlsVisibility);
    els.screen.addEventListener('click', function (ev) {
      if (els.controls.contains(ev.target) || els.topbar.contains(ev.target)) {
        return;
      }
      toggleControlsVisibility();
    });
    document.addEventListener('keydown', function (ev) {
      if (els.modal.classList.contains('visible')) {
        if (ev.key === 'Escape') {
          closeModal();
        }
        return;
      }
      if (ev.key === ' ' || ev.code === 'Space') {
        ev.preventDefault();
        togglePlay();
      } else if (ev.key === 'ArrowRight') {
        state.speed = Math.min(core.MAX_SPEED, state.speed + 10);
        applySettings();
      } else if (ev.key === 'ArrowLeft') {
        state.speed = Math.max(core.MIN_SPEED, state.speed - 10);
        applySettings();
      } else if (ev.key.toLowerCase() === 'f') {
        toggleFullscreen();
      }
    });
    window.addEventListener('resize', measureScroll);
  }

  function init() {
    loadSettings();
    state.paragraphs = core.buildParagraphs(loadText());
    applySettings();
    renderText();
    bindEvents();
    startCamera();
  }

  init();
})();
