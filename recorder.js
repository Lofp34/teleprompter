/*
 * recorder.js — enregistrement local de la caméra et du microphone.
 * La vidéo n'est jamais envoyée sur un serveur : MediaRecorder produit
 * un fichier local proposé en aperçu, téléchargement ou partage natif.
 */
(function () {
  'use strict';

  var core = window.PrompterCore;
  var app = window.TeleprompterApp;
  if (!core || !app) {
    throw new Error('PrompterCore ou TeleprompterApp manquant');
  }

  // Un débit maîtrisé évite les fichiers de plusieurs centaines de Mo sur iPhone.
  // Pour 8 min 40 s, 2,5 Mbit/s + audio produit environ 170 Mo au lieu de ~600 Mo.
  var VIDEO_BITS_PER_SECOND = 2500000;
  var AUDIO_BITS_PER_SECOND = 128000;
  var LARGE_FILE_WARNING_BYTES = 300 * 1024 * 1024;

  var state = {
    mediaRecorder: null,
    recordingStream: null,
    microphoneStream: null,
    chunks: [],
    status: 'idle',
    activeStartedAt: 0,
    accumulatedMs: 0,
    clockRafId: null,
    mimeType: '',
    hasAudio: false,
    blob: null,
    blobUrl: '',
    file: null,
    fileName: ''
  };

  var els = {
    recordDock: document.getElementById('recordDock'),
    recordTime: document.getElementById('recordTime'),
    btnStart: document.getElementById('btnRecordStart'),
    btnPause: document.getElementById('btnRecordPause'),
    btnStop: document.getElementById('btnRecordStop'),
    modal: document.getElementById('recordingModal'),
    preview: document.getElementById('recordingPreview'),
    info: document.getElementById('recordingInfo'),
    btnClose: document.getElementById('btnCloseRecording'),
    btnDownload: document.getElementById('btnDownloadRecording'),
    btnShare: document.getElementById('btnShareRecording')
  };

  function isSupported() {
    return typeof window.MediaRecorder === 'function' &&
      typeof window.MediaStream === 'function';
  }

  function isIOSLike() {
    var userAgent = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function chooseMimeType() {
    var candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm'
    ];

    if (!window.MediaRecorder || typeof window.MediaRecorder.isTypeSupported !== 'function') {
      return '';
    }

    for (var i = 0; i < candidates.length; i += 1) {
      if (window.MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i];
      }
    }
    return '';
  }

  function setStatus(status) {
    state.status = status;
    var statuses = [
      'is-idle',
      'is-preparing',
      'is-recording',
      'is-paused',
      'is-stopping',
      'is-unsupported'
    ];
    statuses.forEach(function (className) {
      els.recordDock.classList.remove(className);
    });
    els.recordDock.classList.add('is-' + status);

    var isIdle = status === 'idle';
    var isActive = status === 'recording' || status === 'paused';
    els.btnStart.disabled = !isIdle;
    els.btnPause.disabled = !isActive;
    els.btnStop.disabled = !isActive;

    if (status === 'paused') {
      els.btnPause.textContent = '▶';
      els.btnPause.title = 'Reprendre l’enregistrement';
      els.btnPause.setAttribute('aria-label', 'Reprendre l’enregistrement');
    } else {
      els.btnPause.textContent = 'Ⅱ';
      els.btnPause.title = 'Mettre l’enregistrement en pause';
      els.btnPause.setAttribute('aria-label', 'Mettre l’enregistrement en pause');
    }
  }

  function activeDurationMs() {
    var total = state.accumulatedMs;
    if (state.status === 'recording' && state.activeStartedAt) {
      total += performance.now() - state.activeStartedAt;
    }
    return Math.max(0, total);
  }

  function updateClock() {
    els.recordTime.textContent = core.formatElapsed(activeDurationMs());
    if (state.status === 'recording') {
      state.clockRafId = requestAnimationFrame(updateClock);
    } else {
      state.clockRafId = null;
    }
  }

  function startClock() {
    cancelClock();
    updateClock();
  }

  function cancelClock() {
    if (state.clockRafId !== null) {
      cancelAnimationFrame(state.clockRafId);
      state.clockRafId = null;
    }
  }

  function addCurrentSegmentToDuration() {
    if (state.activeStartedAt) {
      state.accumulatedMs += performance.now() - state.activeStartedAt;
      state.activeStartedAt = 0;
    }
  }

  function requestMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error('Microphone non supporté'));
    }
    return navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  }

  function buildRecordingStream(cameraStream, microphoneStream) {
    var tracks = [];
    cameraStream.getVideoTracks().forEach(function (track) {
      tracks.push(track);
    });
    if (microphoneStream) {
      microphoneStream.getAudioTracks().forEach(function (track) {
        tracks.push(track);
      });
    }
    return new window.MediaStream(tracks);
  }

  function buildRecorder(stream, requestedMimeType) {
    var options = {};
    if (requestedMimeType) {
      options.mimeType = requestedMimeType;
    }
    if (stream.getVideoTracks().length) {
      options.videoBitsPerSecond = VIDEO_BITS_PER_SECOND;
    }
    if (stream.getAudioTracks().length) {
      options.audioBitsPerSecond = AUDIO_BITS_PER_SECOND;
    }

    try {
      return new window.MediaRecorder(stream, options);
    } catch (err) {
      // Repli pour les navigateurs qui annoncent un format mais refusent le débit.
      if (requestedMimeType) {
        try {
          return new window.MediaRecorder(stream, { mimeType: requestedMimeType });
        } catch (mimeError) {
          // Dernier repli ci-dessous.
        }
      }
    }
    return new window.MediaRecorder(stream);
  }

  function resetCaptureState() {
    cancelClock();
    state.mediaRecorder = null;
    state.recordingStream = null;
    state.chunks = [];
    state.activeStartedAt = 0;
    state.accumulatedMs = 0;
    state.mimeType = '';
    state.hasAudio = false;
    els.recordTime.textContent = '00:00';
  }

  function releaseMicrophone() {
    if (state.microphoneStream) {
      state.microphoneStream.getTracks().forEach(function (track) {
        track.stop();
      });
      state.microphoneStream = null;
    }
  }

  function handleRecorderError(event) {
    var error = event && event.error;
    var message = error && error.message ? error.message : 'Erreur d’enregistrement';
    app.showOverlay(message, 2200);

    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      try {
        finalizeRecording();
      } catch (stopError) {
        releaseMicrophone();
        resetCaptureState();
        setStatus('idle');
      }
    } else {
      releaseMicrophone();
      resetCaptureState();
      setStatus('idle');
    }
  }

  function startMediaRecorder(recorder) {
    try {
      recorder.start(1000);
    } catch (err) {
      recorder.start();
    }
  }

  function startRecording() {
    if (state.status !== 'idle' || !isSupported()) {
      return;
    }

    clearRecordingResult();
    setStatus('preparing');
    app.showOverlay('Préparation de l’enregistrement…');

    var microphonePromise = requestMicrophone().then(function (stream) {
      state.microphoneStream = stream;
      return stream;
    }).catch(function () {
      state.microphoneStream = null;
      return null;
    });

    Promise.all([app.ensureCamera(), microphonePromise]).then(function (results) {
      if (state.status !== 'preparing') {
        releaseMicrophone();
        return;
      }

      var cameraStream = results[0];
      var microphoneStream = results[1];
      var recordingStream = buildRecordingStream(cameraStream, microphoneStream);
      if (!recordingStream.getVideoTracks().length) {
        throw new Error('Aucune piste vidéo disponible');
      }

      var requestedMimeType = chooseMimeType();
      var recorder = buildRecorder(recordingStream, requestedMimeType);
      state.recordingStream = recordingStream;
      state.mediaRecorder = recorder;
      state.chunks = [];
      state.mimeType = recorder.mimeType || requestedMimeType || 'video/webm';
      state.hasAudio = recordingStream.getAudioTracks().length > 0;

      recorder.addEventListener('dataavailable', function (event) {
        if (event.data && event.data.size > 0) {
          state.chunks.push(event.data);
        }
      });
      recorder.addEventListener('stop', completeRecording);
      recorder.addEventListener('error', handleRecorderError);

      state.activeStartedAt = performance.now();
      state.accumulatedMs = 0;
      setStatus('recording');
      startMediaRecorder(recorder);
      startClock();
      app.hideOverlay();
      if (!state.hasAudio) {
        app.showOverlay('Enregistrement sans son', 1700);
      }
    }).catch(function (err) {
      releaseMicrophone();
      resetCaptureState();
      setStatus('idle');
      var message = err && err.message ? err.message : 'Impossible de démarrer l’enregistrement';
      app.showOverlay(message, 2300);
    });
  }

  function toggleRecordingPause() {
    var recorder = state.mediaRecorder;
    if (!recorder) {
      return;
    }

    if (state.status === 'recording' && recorder.state === 'recording') {
      addCurrentSegmentToDuration();
      recorder.pause();
      cancelClock();
      setStatus('paused');
      els.recordTime.textContent = core.formatElapsed(state.accumulatedMs);
      return;
    }

    if (state.status === 'paused' && recorder.state === 'paused') {
      recorder.resume();
      state.activeStartedAt = performance.now();
      setStatus('recording');
      startClock();
    }
  }

  function finalizeRecording() {
    var recorder = state.mediaRecorder;
    if (!recorder || (state.status !== 'recording' && state.status !== 'paused')) {
      return;
    }

    if (state.status === 'recording') {
      addCurrentSegmentToDuration();
    }
    cancelClock();
    setStatus('stopping');
    els.recordTime.textContent = core.formatElapsed(state.accumulatedMs);

    try {
      recorder.stop();
    } catch (err) {
      releaseMicrophone();
      resetCaptureState();
      setStatus('idle');
      app.showOverlay('Impossible de finaliser la vidéo', 2200);
    }
  }

  function completeRecording() {
    var durationMs = state.accumulatedMs;
    var type = normalizedMimeType(state.mimeType, state.chunks);
    var chunks = state.chunks.slice();

    releaseMicrophone();
    state.mediaRecorder = null;
    state.recordingStream = null;
    state.chunks = [];
    state.activeStartedAt = 0;
    state.accumulatedMs = 0;
    cancelClock();
    setStatus('idle');

    if (!chunks.length) {
      els.recordTime.textContent = '00:00';
      app.showOverlay('Aucune donnée vidéo enregistrée', 2200);
      return;
    }

    var blob = new Blob(chunks, { type: type });
    if (!blob.size) {
      els.recordTime.textContent = '00:00';
      app.showOverlay('La vidéo enregistrée est vide', 2200);
      return;
    }

    state.blob = blob;
    state.mimeType = type;
    state.fileName = buildFileName(type);
    state.blobUrl = URL.createObjectURL(blob);
    state.file = buildFile(blob, state.fileName, type);
    showRecordingResult(durationMs);
  }

  function normalizedMimeType(recorderMimeType, chunks) {
    var raw = recorderMimeType || '';
    if (!raw && chunks.length && chunks[0].type) {
      raw = chunks[0].type;
    }
    if (!raw) {
      return 'video/webm';
    }

    // Le partage iOS accepte mieux un type simple (video/mp4) qu'un type
    // enrichi de paramètres codecs.
    return String(raw).split(';')[0].trim() || 'video/webm';
  }

  function extensionForMimeType(type) {
    return String(type).toLowerCase().indexOf('mp4') !== -1 ? 'mp4' : 'webm';
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function buildFileName(type) {
    var now = new Date();
    return 'teleprompter-' +
      now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + '-' +
      pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds()) + '.' +
      extensionForMimeType(type);
  }

  function buildFile(blob, name, type) {
    if (typeof window.File !== 'function') {
      return null;
    }
    try {
      return new window.File([blob], name, {
        type: type,
        lastModified: Date.now()
      });
    } catch (err) {
      return null;
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024 * 1024) {
      return Math.max(1, Math.round(bytes / 1024)) + ' Ko';
    }
    return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0) + ' Mo';
  }

  function canShareFile(file) {
    if (!file || typeof navigator.share !== 'function') {
      return false;
    }
    if (typeof navigator.canShare !== 'function') {
      return true;
    }
    try {
      return navigator.canShare({ files: [file] });
    } catch (err) {
      return false;
    }
  }

  function showRecordingResult(durationMs) {
    var nativeShareAvailable = isIOSLike() && canShareFile(state.file);
    var infoSuffix = '. La vidéo reste sur cet appareil.';

    app.pauseScroll();
    els.preview.src = state.blobUrl;
    els.preview.load();

    if (nativeShareAvailable) {
      els.btnDownload.textContent = isIOSLike() ?
        'Enregistrer dans Photos / Fichiers' :
        'Enregistrer / partager';
    } else {
      els.btnDownload.textContent = 'Télécharger la vidéo';
    }

    // Un seul bouton principal : sur iPhone il ouvre la feuille de partage
    // native, ailleurs il télécharge le fichier si le partage est indisponible.
    els.btnShare.hidden = true;

    if (isIOSLike() && nativeShareAvailable) {
      infoSuffix += ' Touchez le bouton puis choisissez « Enregistrer la vidéo » ou « Enregistrer dans Fichiers ».';
    }
    if (state.blob.size >= LARGE_FILE_WARNING_BYTES) {
      infoSuffix += ' Fichier volumineux : ne fermez pas cette page avant la fin de l’export.';
    }

    els.info.textContent = core.formatElapsed(durationMs) + ' • ' +
      formatFileSize(state.blob.size) + ' • ' +
      (state.hasAudio ? 'avec son' : 'sans son') +
      infoSuffix;
    els.modal.classList.add('visible');
    els.recordTime.textContent = core.formatElapsed(durationMs);
  }

  function clearRecordingResult() {
    els.modal.classList.remove('visible');
    els.preview.pause();
    els.preview.removeAttribute('src');
    els.preview.load();
    els.btnShare.hidden = true;
    els.info.textContent = '';

    if (state.blobUrl) {
      URL.revokeObjectURL(state.blobUrl);
    }
    state.blob = null;
    state.blobUrl = '';
    state.file = null;
    state.fileName = '';
    if (state.status === 'idle') {
      els.recordTime.textContent = '00:00';
    }
  }

  function shareRecording() {
    if (!canShareFile(state.file)) {
      return Promise.resolve(false);
    }
    return navigator.share({
      files: [state.file],
      title: 'Vidéo téléprompteur'
    }).then(function () {
      return true;
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        return false;
      }
      app.showOverlay('Le partage n’a pas pu être ouvert', 2000);
      return false;
    });
  }

  function downloadRecording() {
    if (!state.blobUrl || !state.blob) {
      return;
    }

    if (isIOSLike() && canShareFile(state.file)) {
      shareRecording();
      return;
    }

    var link = document.createElement('a');
    link.href = state.blobUrl;
    link.download = state.fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    app.showOverlay('Téléchargement lancé : gardez cette page ouverte', 2400);
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', startRecording);
    els.btnPause.addEventListener('click', toggleRecordingPause);
    els.btnStop.addEventListener('click', finalizeRecording);
    els.btnClose.addEventListener('click', clearRecordingResult);
    els.btnDownload.addEventListener('click', downloadRecording);
    els.btnShare.addEventListener('click', shareRecording);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.status === 'recording') {
        toggleRecordingPause();
      }
    });

    window.addEventListener('pagehide', function () {
      cancelClock();
      releaseMicrophone();

      // Ne jamais révoquer state.blobUrl ici : sur Safari iOS, l'ouverture
      // du téléchargement masque la page avant que le gros blob soit lu.
      // Le révoquer à ce moment provoque « WebKitBlobResource error 1 ».
      // L'URL est libérée dans clearRecordingResult(), ou par le navigateur
      // lorsque le document est réellement détruit.
    });
  }

  function init() {
    bindEvents();
    if (!isSupported()) {
      setStatus('unsupported');
      els.btnStart.disabled = true;
      els.btnStart.title = 'Enregistrement non supporté par ce navigateur';
      els.btnStart.setAttribute('aria-label', 'Enregistrement non supporté par ce navigateur');
      els.recordTime.textContent = '—';
      return;
    }
    setStatus('idle');
  }

  init();
})();
