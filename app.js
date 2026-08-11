/*
 * app.js — cœur du prompteur vidéo mobile.
 * Caméra (getUserMedia), texte défilant et navigation tactile.
 * Aucun envoi réseau, aucune dépendance externe. Le texte et les réglages
 * restent sur l'appareil (localStorage).
 */
(function () {
  'use strict';

  var core = window.PrompterCore;
  if (!core) {
    throw new Error('PrompterCore manquant');
  }

  var STORAGE_TEXT_KEY = 'teleprompter.text.v1';
  var STORAGE_SETTINGS_KEY = 'teleprompter.settings.v1';
  var DRAG_THRESHOLD_PX = 7;
  var DRAG_MULTIPLIER = 1.25;

  var state = {
    running: false,
    countingDown: false,
    hasStarted: false,
    startedAt: 0,
    accumulatedMs: 0,
    lastFrameAt: 0,
    scrollPosition: 0,
    rafId: null,
    countdownTimer: null,
    countdownValue: 3,
    paragraphs: [],
    maxScroll: 0,
    speed: core.DEFAULT_SPEED,
    fontSize: core.DEFAULT_FONT,
    opacity: core.DEFAULT_OPACITY,
    mirror: true,
    camStream: null,
    cameraPromise: null,
    gesturePointerId: null,
    gestureStartY: 0,
    gestureStartPosition: 0,
    gestureMoved: false,
    gestureResumeAfter: false,
    suppressSurfaceClickUntil: 0
  };

  var els = {
    screen: document.getElementById('screen'),
    video: document.getElementById('cam'),
    textLayer: document.getElementById('textLayer'),
    textInner: document.getElementById('textInner'),
    gestureSurface: document.getElementById('gestureSurface'),
    elapsed: document.getElementById('elapsed'),
    btnFullscreen: document.getElementById('btnFullscreen'),
    btnToggleControls: document.getElementById('btnToggleControls'),
    btnPlay: document.getElementById('btnPlay'),
    btnReset: document.getElementById('btnReset'),
    speedSlider: document.getElementById('speedSlider'),
    speedValue: document.getElementById('speedValue'),
    quickSpeedSlider: document.getElementById('quickSpeedSlider'),
    quickSpeedValue: document.getElementById('quickSpeedValue'),
    fontSlider: document.getElementById('fontSlider'),
    fontValue: document.getElementById('fontValue'),
    opacitySlider: document.getElementById('opacitySlider'),
    opacityValue: document.getElementById('opacityValue'),
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
      var saved = JSON.parse(raw);
      state.speed = core.clampSpeed(saved.speed);
      state.fontSize = core.clampFontSize(saved.fontSize);
      state.opacity = core.clampOpacity(saved.opacity);
      state.mirror = saved.mirror !== false;
    } catch (e) {
      // Stockage indisponible : valeurs par défaut conservées.
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
      // Stockage indisponible : rien à faire.
    }
  }

  function loadText() {
    try {
      var saved = localStorage.getItem(STORAGE_TEXT_KEY);
      if (saved) {
        return saved;
      }
    } catch (e) {
      // Stockage indisponible.
    }
    return 'Exemple — remplacez ce texte par votre script.\n\n' +
      'Bonjour et bienvenue. Ceci est un texte d\'exemple synthétique ' +
      'pour vérifier le défilement du prompteur.';
  }

  function saveText(text) {
    try {
      localStorage.setItem(STORAGE_TEXT_KEY, text);
    } catch (e) {
      // Stockage indisponible : texte conservé en mémoire uniquement.
    }
  }

  function formatOpacity(value) {
    return String(value.toFixed(2)).replace(/0+$/, '').replace(/\.$/, '');
  }

  function applySettings() {
    els.textInner.style.fontSize = state.fontSize + 'px';
    els.textInner.style.opacity = String(state.opacity);
    els.speedSlider.value = String(state.speed);
    els.speedValue.textContent = state.speed + ' px/s';
    els.quickSpeedSlider.value = String(state.speed);
    els.quickSpeedValue.textContent = String(state.speed);
    els.fontSlider.value = String(state.fontSize);
    els.fontValue.textContent = state.fontSize + ' px';
    els.opacitySlider.value = String(state.opacity);
    els.opacityValue.textContent = formatOpacity(state.opacity);
    els.mirrorToggle.checked = state.mirror;
    els.screen.classList.toggle('mirror', state.mirror);
    saveSettings();
  }

  function setSpeed(value) {
    state.speed = core.clampSpeed(Number(value));
    els.speedSlider.value = String(state.speed);
    els.speedValue.textContent = state.speed + ' px/s';
    els.quickSpeedSlider.value = String(state.speed);
    els.quickSpeedValue.textContent = String(state.speed);
    saveSettings();
  }

  function renderText() {
    els.textInner.textContent = '';
    state.paragraphs.forEach(function (paragraph) {
      var node = document.createElement('p');
      node.textContent = paragraph;
      els.textInner.appendChild(node);
    });
    measureScroll(false);
    resetScroll();
  }

  function clampScrollPosition(value) {
    var numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      numeric = 0;
    }
    return Math.min(state.maxScroll, Math.max(0, numeric));
  }

  function renderScrollPosition() {
    els.textInner.style.transform = 'translateY(-' + state.scrollPosition.toFixed(2) + 'px)';
  }

  function setScrollPosition(value) {
    state.scrollPosition = clampScrollPosition(value);
    renderScrollPosition();
  }

  function measureScroll(preserveProgress) {
    var oldMax = state.maxScroll;
    var oldProgress = oldMax > 0 ? state.scrollPosition / oldMax : 0;
    state.maxScroll = Math.max(0, els.textInner.scrollHeight - els.textLayer.clientHeight);

    if (preserveProgress && oldMax > 0) {
      state.scrollPosition = oldProgress * state.maxScroll;
    }
    state.scrollPosition = clampScrollPosition(state.scrollPosition);
    renderScrollPosition();
  }

  function cancelRaf() {
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  }

  function cancelCountdown() {
    if (state.countdownTimer !== null) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
    state.countingDown = false;
  }

  function resetScroll() {
    cancelCountdown();
    state.running = false;
    state.hasStarted = false;
    state.accumulatedMs = 0;
    state.scrollPosition = 0;
    cancelRaf();
    renderScrollPosition();
    els.elapsed.textContent = '00:00';
    updatePlayButton();
  }

  function updatePlayButton() {
    if (state.countingDown) {
      els.btnPlay.textContent = '✕';
      els.btnPlay.setAttribute('aria-label', 'Annuler le compte à rebours');
      return;
    }
    els.btnPlay.textContent = state.running ? '⏸' : '▶';
    els.btnPlay.setAttribute('aria-label', state.running ? 'Mettre le défilement en pause' : 'Lancer le défilement');
  }

  function advanceScrollTo(now) {
    if (!state.running) {
      return;
    }
    var deltaMs = Math.max(0, now - state.lastFrameAt);
    state.lastFrameAt = now;
    setScrollPosition(state.scrollPosition + (deltaMs / 1000) * state.speed);
  }

  function startScroll(silentUi) {
    if (state.maxScroll <= 0) {
      showOverlay('Le texte tient déjà à l’écran', 1600);
      state.running = false;
      if (!silentUi) {
        updatePlayButton();
      }
      return;
    }

    var now = performance.now();
    state.startedAt = now;
    state.lastFrameAt = now;
    state.running = true;
    if (!silentUi) {
      updatePlayButton();
    }
    cancelRaf();
    state.rafId = requestAnimationFrame(tick);
  }

  function pauseScroll(silentUi) {
    if (!state.running) {
      return;
    }
    var now = performance.now();
    advanceScrollTo(now);
    state.accumulatedMs += Math.max(0, now - state.startedAt);
    state.running = false;
    cancelRaf();
    els.elapsed.textContent = core.formatElapsed(state.accumulatedMs);
    if (!silentUi) {
      updatePlayButton();
    }
  }

  function tick(now) {
    state.rafId = null;
    if (!state.running) {
      return;
    }

    advanceScrollTo(now);
    var elapsedMs = state.accumulatedMs + Math.max(0, now - state.startedAt);
    els.elapsed.textContent = core.formatElapsed(elapsedMs);

    if (core.isAtEnd(state.scrollPosition, state.maxScroll)) {
      state.accumulatedMs = elapsedMs;
      state.running = false;
      updatePlayButton();
      showOverlay('Fin du texte', 1800);
      return;
    }
    state.rafId = requestAnimationFrame(tick);
  }

  function beginCountdown() {
    var remaining = state.countdownValue;
    state.countingDown = true;
    updatePlayButton();

    if (remaining <= 0) {
      state.countingDown = false;
      updatePlayButton();
      startScroll(false);
      return;
    }

    showOverlay(String(remaining), 900);
    state.countdownTimer = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(state.countdownTimer);
        state.countdownTimer = null;
        state.countingDown = false;
        hideOverlay();
        updatePlayButton();
        startScroll(false);
      } else {
        showOverlay(String(remaining), 900);
      }
    }, 1000);
  }

  function togglePlay() {
    if (state.countingDown) {
      cancelCountdown();
      state.hasStarted = false;
      hideOverlay();
      updatePlayButton();
      return;
    }
    if (state.running) {
      pauseScroll(false);
      return;
    }
    if (core.isAtEnd(state.scrollPosition, state.maxScroll)) {
      setScrollPosition(0);
      state.accumulatedMs = 0;
      els.elapsed.textContent = '00:00';
    }
    if (!state.hasStarted) {
      state.hasStarted = true;
      beginCountdown();
    } else {
      startScroll(false);
    }
  }

  function showOverlay(text, durationMs) {
    els.overlay.textContent = text;
    els.overlay.classList.toggle('compact', String(text).length > 4);
    els.overlay.classList.add('visible');
    clearTimeout(showOverlay._timer);
    if (durationMs) {
      showOverlay._timer = setTimeout(hideOverlay, durationMs);
    }
  }

  function hideOverlay() {
    els.overlay.classList.remove('visible');
    els.overlay.classList.remove('compact');
  }

  function startCamera() {
    if (state.camStream && state.camStream.active) {
      return Promise.resolve(state.camStream);
    }
    if (state.cameraPromise) {
      return state.cameraPromise;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var unsupportedError = new Error('getUserMedia non supporté');
      showCameraError('Caméra non supportée par ce navigateur. Utilisez Safari ou Chrome récent.');
      return Promise.reject(unsupportedError);
    }

    state.cameraPromise = navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    }).then(function (stream) {
      state.camStream = stream;
      state.cameraPromise = null;
      els.video.srcObject = stream;
      els.video.classList.add('active');
      els.video.play().catch(function () { /* Lecture différée par le navigateur. */ });
      hideCameraError();

      stream.getVideoTracks().forEach(function (track) {
        track.addEventListener('ended', function () {
          if (state.camStream === stream) {
            showCameraError('La caméra a été interrompue. Rechargez la page pour la réactiver.');
          }
        });
      });
      return stream;
    }).catch(function (err) {
      state.cameraPromise = null;
      showCameraError(cameraErrorMessage(err));
      throw err;
    });

    return state.cameraPromise;
  }

  function cameraErrorMessage(err) {
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
    return message;
  }

  function showCameraError(message) {
    els.camError.textContent = message;
    els.camError.classList.add('visible');
  }

  function hideCameraError() {
    els.camError.classList.remove('visible');
  }

  function getFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function toggleFullscreen() {
    var result;
    if (getFullscreenElement()) {
      var exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
      if (exitFullscreen) {
        result = exitFullscreen.call(document);
      }
    } else {
      var requestFullscreen = els.screen.requestFullscreen || els.screen.webkitRequestFullscreen;
      if (requestFullscreen) {
        result = requestFullscreen.call(els.screen);
      } else {
        showOverlay('Plein écran non disponible dans ce navigateur', 1800);
      }
    }
    if (result && typeof result.catch === 'function') {
      result.catch(function () {
        showOverlay('Plein écran non disponible', 1600);
      });
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

  function beginGesture(ev) {
    if (typeof ev.button === 'number' && ev.button !== 0) {
      return;
    }
    state.gesturePointerId = ev.pointerId;
    state.gestureStartY = ev.clientY;
    state.gestureStartPosition = state.scrollPosition;
    state.gestureMoved = false;
    state.gestureResumeAfter = false;
    if (els.gestureSurface.setPointerCapture) {
      try {
        els.gestureSurface.setPointerCapture(ev.pointerId);
      } catch (e) {
        // Capture facultative.
      }
    }
  }

  function moveGesture(ev) {
    if (state.gesturePointerId === null || ev.pointerId !== state.gesturePointerId) {
      return;
    }
    var deltaY = ev.clientY - state.gestureStartY;

    if (!state.gestureMoved) {
      if (Math.abs(deltaY) < DRAG_THRESHOLD_PX) {
        return;
      }
      state.gestureMoved = true;
      state.gestureResumeAfter = state.running;
      if (state.running) {
        pauseScroll(true);
      }
      state.gestureStartPosition = state.scrollPosition;
      els.screen.classList.add('is-scrubbing');
    }

    ev.preventDefault();
    setScrollPosition(state.gestureStartPosition - deltaY * DRAG_MULTIPLIER);
  }

  function endGesture(ev) {
    if (state.gesturePointerId === null || ev.pointerId !== state.gesturePointerId) {
      return;
    }

    if (state.gestureMoved) {
      state.suppressSurfaceClickUntil = Date.now() + 400;
      els.screen.classList.remove('is-scrubbing');
      if (state.gestureResumeAfter && !core.isAtEnd(state.scrollPosition, state.maxScroll)) {
        startScroll(true);
      } else {
        updatePlayButton();
      }
    }

    if (els.gestureSurface.releasePointerCapture) {
      try {
        els.gestureSurface.releasePointerCapture(ev.pointerId);
      } catch (e) {
        // Capture déjà relâchée.
      }
    }
    state.gesturePointerId = null;
    state.gestureMoved = false;
    state.gestureResumeAfter = false;
  }

  function bindEvents() {
    els.btnPlay.addEventListener('click', togglePlay);
    els.btnReset.addEventListener('click', function () {
      resetScroll();
      hideOverlay();
    });
    els.speedSlider.addEventListener('input', function () {
      setSpeed(els.speedSlider.value);
    });
    els.quickSpeedSlider.addEventListener('input', function () {
      setSpeed(els.quickSpeedSlider.value);
    });
    els.fontSlider.addEventListener('input', function () {
      state.fontSize = core.clampFontSize(Number(els.fontSlider.value));
      els.fontValue.textContent = state.fontSize + ' px';
      els.textInner.style.fontSize = state.fontSize + 'px';
      saveSettings();
      measureScroll(true);
    });
    els.opacitySlider.addEventListener('input', function () {
      state.opacity = core.clampOpacity(Number(els.opacitySlider.value));
      els.opacityValue.textContent = formatOpacity(state.opacity);
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

    els.gestureSurface.addEventListener('pointerdown', beginGesture);
    els.gestureSurface.addEventListener('pointermove', moveGesture);
    els.gestureSurface.addEventListener('pointerup', endGesture);
    els.gestureSurface.addEventListener('pointercancel', endGesture);
    els.gestureSurface.addEventListener('click', function (ev) {
      if (Date.now() < state.suppressSurfaceClickUntil) {
        ev.preventDefault();
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
        setSpeed(state.speed + 10);
      } else if (ev.key === 'ArrowLeft') {
        setSpeed(state.speed - 10);
      } else if (ev.key === 'ArrowUp') {
        setScrollPosition(state.scrollPosition + 80);
      } else if (ev.key === 'ArrowDown') {
        setScrollPosition(state.scrollPosition - 80);
      } else if (ev.key.toLowerCase() === 'f') {
        toggleFullscreen();
      }
    });

    window.addEventListener('resize', function () {
      measureScroll(true);
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () { measureScroll(true); }, 250);
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.running) {
        pauseScroll(false);
      }
    });
  }

  window.TeleprompterApp = {
    ensureCamera: startCamera,
    pauseScroll: function () {
      if (state.running) {
        pauseScroll(false);
      }
    },
    showOverlay: showOverlay,
    hideOverlay: hideOverlay
  };

  function init() {
    loadSettings();
    state.paragraphs = core.buildParagraphs(loadText());
    applySettings();
    renderText();
    bindEvents();
    startCamera().catch(function () {
      // Le message d'erreur détaillé est déjà affiché dans l'interface.
    });
  }

  init();
})();
