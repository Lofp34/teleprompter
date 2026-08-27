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

  // Un débit maîtrisé réduit fortement le poids des prises longues sur iPhone,
  // tout en conservant une bonne qualité pour une vidéo face caméra en 1080p.
  var TARGET_VIDEO_BITRATE = 4000000;
  var TARGET_AUDIO_BITRATE = 128000;
  var LARGE_FILE_BYTES = 350 * 1024 * 1024;

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
    fileName: '',
    resultSummary: '',
    saving: false
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

  function isAppleMobile() {
    var userAgent = navigator.userAgent || '';
    var classicIOS = /iPad|iPhone|iPod/.test(userAgent);
    var modernIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    return classicIOS || modernIPad;
  }

  function isMobileDevice() {
    return isAppleMobile() || /Android/i.test(navigator.userAgent || '');
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

  function recorderOptions(stream, requestedMimeType, withBitrate) {
    var options = {};
    if (requestedMimeType) {
      options.mimeType = requestedMimeType;
    }
    if (withBitrate) {
      options.videoBitsPerSecond = TARGET_VIDEO_BITRATE;
      if (stream.getAudioTracks().length) {
        options.audioBitsPerSecond = TARGET_AUDIO_BITRATE;
      }
    }
    return options;
  }

  function buildRecorder(stream, requestedMimeType) {
    var attempts = [
      recorderOptions(stream, requestedMimeType, true),
      recorderOptions(stream, requestedMimeType, false),
      recorderOptions(stream, '', true),
      null
    ];

    for (var i = 0; i < attempts.length; i += 1) {
      try {
        if (attempts[i]) {
          return new window.MediaRecorder(stream, attempts[i]);
        }
        return new window.MediaRecorder(stream);
      } catch (err) {
        // Certains navigateurs annoncent un format ou un débit puis refusent
        // les options. L'essai suivant utilise une configuration plus simple.
      }
    }

    throw new Error('Impossible de créer l’enregistreur vidéo');
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
    state.file = buildFile(blob, state.fileName, baseMimeType(type));
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
    return raw;
  }

  function baseMimeType(type) {
    return String(type || 'video/mp4').split(';')[0].trim() || 'video/mp4';
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

  function prefersNativeSave() {
    return isMobileDevice() && canShareFile(state.file);
  }

  function setSaving(saving) {
    state.saving = saving;
    els.btnDownload.disabled = saving;
    if (els.btnShare) {
      els.btnShare.disabled = saving;
    }
  }

  function setResultMessage(message) {
    els.info.textContent = state.resultSummary + (message ? ' ' + message : '');
  }

  function showRecordingResult(durationMs) {
    app.pauseScroll();
    els.preview.src = state.blobUrl;
    els.preview.load();

    var nativeSave = prefersNativeSave();
    if (nativeSave && isAppleMobile()) {
      els.btnDownload.textContent = 'Enregistrer sur l’iPhone';
    } else if (nativeSave) {
      els.btnDownload.textContent = 'Enregistrer / partager';
    } else {
      els.btnDownload.textContent = 'Télécharger la vidéo';
    }

    if (els.btnShare) {
      els.btnShare.hidden = !canShareFile(state.file) || nativeSave;
    }

    state.resultSummary = core.formatElapsed(durationMs) + ' • ' +
      formatFileSize(state.blob.size) + ' • ' +
      (state.hasAudio ? 'avec son' : 'sans son') + '.';

    if (nativeSave && isAppleMobile()) {
      state.resultSummary += ' Touchez « Enregistrer sur l’iPhone », puis choisissez « Enregistrer la vidéo » ou « Enregistrer dans Fichiers ».';
    } else {
      state.resultSummary += ' La vidéo reste disponible tant que cette fenêtre n’est pas fermée.';
    }

    if (state.blob.size >= LARGE_FILE_BYTES) {
      state.resultSummary += ' Fichier volumineux : ne rechargez pas la page avant la fin de la sauvegarde.';
    }

    setResultMessage('');
    els.modal.classList.add('visible');
    els.recordTime.textContent = core.formatElapsed(durationMs);
  }

  function clearRecordingResult() {
    els.modal.classList.remove('visible');
    els.preview.pause();
    els.preview.removeAttribute('src');
    els.preview.load();
    els.btnDownload.disabled = false;
    els.btnDownload.textContent = 'Enregistrer la vidéo';
    if (els.btnShare) {
      els.btnShare.hidden = true;
      els.btnShare.disabled = false;
    }
    els.info.textContent = '';

    if (state.blobUrl) {
      URL.revokeObjectURL(state.blobUrl);
    }
    state.blob = null;
    state.blobUrl = '';
    state.file = null;
    state.fileName = '';
    state.resultSummary = '';
    state.saving = false;
    if (state.status === 'idle') {
      els.recordTime.textContent = '00:00';
    }
  }

  function downloadRecording() {
    if (!state.blobUrl || !state.fileName) {
      setResultMessage('Le fichier vidéo n’est plus disponible.');
      return;
    }

    // Sur iPhone/iPad, forcer l'ouverture d'une URL blob peut afficher
    // « WebKitBlobResource erreur 1 ». On ne prend donc jamais ce chemin :
    // la feuille de partage native est la voie de sauvegarde fiable.
    if (isAppleMobile()) {
      if (canShareFile(state.file)) {
        shareRecording();
      } else {
        setResultMessage('Safari ne permet pas de télécharger directement ce fichier. Utilisez une version récente de Safari pour ouvrir la sauvegarde iOS.');
      }
      return;
    }

    var link = document.createElement('a');
    link.href = state.blobUrl;
    link.download = state.fileName;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(function () {
      link.remove();
    }, 0);
  }

  function shareRecording() {
    if (state.saving || !canShareFile(state.file)) {
      return;
    }

    setSaving(true);
    setResultMessage('Ouverture de la sauvegarde iOS…');

    navigator.share({
      files: [state.file],
      title: 'Vidéo téléprompteur'
    }).then(function () {
      setSaving(false);
      setResultMessage('La feuille de partage a été refermée. La vidéo reste disponible ici en cas de besoin.');
    }).catch(function (err) {
      setSaving(false);
      if (err && err.name === 'AbortError') {
        setResultMessage('Sauvegarde annulée. La vidéo est toujours disponible : vous pouvez réessayer.');
        return;
      }
      setResultMessage('Impossible d’ouvrir la sauvegarde. Ne fermez pas cette page et réessayez.');
    });
  }

  function saveRecording() {
    if (state.saving) {
      return;
    }
    if (prefersNativeSave()) {
      shareRecording();
      return;
    }
    downloadRecording();
  }

  function bindEvents() {
    els.btnStart.addEventListener('click', startRecording);
    els.btnPause.addEventListener('click', toggleRecordingPause);
    els.btnStop.addEventListener('click', finalizeRecording);
    els.btnClose.addEventListener('click', clearRecordingResult);
    els.btnDownload.addEventListener('click', saveRecording);
    if (els.btnShare) {
      els.btnShare.addEventListener('click', shareRecording);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && state.status === 'recording') {
        toggleRecordingPause();
      }
    });

    window.addEventListener('pagehide', function () {
      cancelClock();
      releaseMicrophone();
      // Ne pas révoquer state.blobUrl ici : Safari peut placer la page dans
      // son cache de navigation ou ouvrir une feuille système. La révocation
      // est faite uniquement lors d'une nouvelle prise.
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

  // Point de secours utile lors du débogage à distance d'un iPhone : il ne
  // contient aucune donnée, mais permet de relancer la sauvegarde du fichier
  // déjà présent dans la page sans recréer la vidéo.
  window.TeleprompterRecorder = {
    saveCurrentRecording: saveRecording,
    shareCurrentRecording: shareRecording
  };

  init();
})();
