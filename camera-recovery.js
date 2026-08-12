/*
 * camera-recovery.js — réactivation robuste de la caméra après une prise.
 * Certains Safari/iPhone terminent la piste vidéo lorsque MediaRecorder est
 * finalisé. Ce module relance alors automatiquement l'aperçu et conserve un
 * bouton de secours utilisable sans recharger toute la page.
 */
(function () {
  'use strict';

  var app = window.TeleprompterApp;
  var video = document.getElementById('cam');
  var camError = document.getElementById('camError');
  var btnNewTake = document.getElementById('btnCloseRecording');

  if (!app || !video || !camError || !btnNewTake) {
    return;
  }

  var recoveryPromise = null;
  var scheduledRecovery = null;
  var automaticAttempts = 0;
  var MAX_AUTOMATIC_ATTEMPTS = 2;

  function getVideoTracks(stream) {
    if (!stream || typeof stream.getVideoTracks !== 'function') {
      return [];
    }
    return stream.getVideoTracks();
  }

  function hasLiveVideoTrack(stream) {
    return getVideoTracks(stream).some(function (track) {
      return track.readyState === 'live';
    });
  }

  function stopAndDetachStream(stream) {
    if (!stream) {
      return;
    }

    if (typeof stream.getTracks === 'function') {
      stream.getTracks().forEach(function (track) {
        if (track.readyState !== 'ended') {
          try {
            track.stop();
          } catch (e) {
            // Une piste déjà libérée peut refuser stop() sur certains Safari.
          }
        }
      });
    }

    try {
      video.pause();
    } catch (e) {
      // pause() est seulement une précaution visuelle.
    }
    video.srcObject = null;
    video.classList.remove('active');
  }

  function buildRecoveryMessage(message) {
    var text = String(message || '').trim();
    if (!text) {
      return 'La caméra est momentanément indisponible.';
    }
    return text.replace(/\s*Rechargez la page pour la réactiver\.?\s*$/i, '');
  }

  function showRecoverableError(message) {
    var messageNode = document.createElement('p');
    var button = document.createElement('button');

    messageNode.textContent = buildRecoveryMessage(message);
    messageNode.style.maxWidth = '680px';

    button.type = 'button';
    button.textContent = 'Réactiver la caméra';
    button.setAttribute('data-camera-recovery-button', 'true');
    button.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      recoverCamera(true).catch(function () {
        // Le message détaillé reste affiché dans #camError.
      });
    });

    camError.textContent = '';
    camError.style.flexDirection = 'column';
    camError.style.gap = '16px';
    camError.appendChild(messageNode);
    camError.appendChild(button);
    camError.classList.add('visible');
  }

  function decorateCurrentError() {
    if (!camError.classList.contains('visible')) {
      return;
    }
    if (camError.querySelector('[data-camera-recovery-button]')) {
      return;
    }
    showRecoverableError(camError.textContent);
  }

  function finishRecovery() {
    recoveryPromise = null;
  }

  function recoverCamera(forceRestart) {
    var currentStream;
    var ensurePromise;

    if (recoveryPromise) {
      return recoveryPromise;
    }

    if (scheduledRecovery !== null) {
      clearTimeout(scheduledRecovery);
      scheduledRecovery = null;
    }

    currentStream = video.srcObject;
    if (forceRestart || !hasLiveVideoTrack(currentStream)) {
      stopAndDetachStream(currentStream);
    }

    camError.classList.remove('visible');
    app.showOverlay('Réactivation de la caméra…');

    try {
      ensurePromise = app.ensureCamera();
    } catch (error) {
      ensurePromise = Promise.reject(error);
    }

    recoveryPromise = Promise.resolve(ensurePromise).then(function (stream) {
      var activeStream = stream || video.srcObject;
      var playResult;

      if (!hasLiveVideoTrack(activeStream)) {
        throw new Error('Aucune piste vidéo active n’a pu être obtenue.');
      }

      if (video.srcObject !== activeStream) {
        video.srcObject = activeStream;
      }
      video.classList.add('active');
      playResult = video.play();

      if (playResult && typeof playResult.catch === 'function') {
        return playResult.catch(function () {
          // Sur iOS, l'image peut tout de même apparaître sans promesse résolue.
        });
      }
      return null;
    }).then(function () {
      automaticAttempts = 0;
      camError.classList.remove('visible');
      app.hideOverlay();
      finishRecovery();
      return video.srcObject;
    }, function (error) {
      app.hideOverlay();
      finishRecovery();
      showRecoverableError(
        error && error.message
          ? 'Impossible de réactiver la caméra : ' + error.message
          : 'Impossible de réactiver la caméra.'
      );
      return Promise.reject(error);
    });

    return recoveryPromise;
  }

  function scheduleAutomaticRecovery() {
    var delay;

    if (recoveryPromise || scheduledRecovery !== null ||
        automaticAttempts >= MAX_AUTOMATIC_ATTEMPTS || document.hidden) {
      return;
    }

    automaticAttempts += 1;
    delay = automaticAttempts === 1 ? 180 : 750;
    scheduledRecovery = setTimeout(function () {
      scheduledRecovery = null;
      recoverCamera(true).catch(function () {
        // Le bouton manuel reste disponible après l'échec automatique.
      });
    }, delay);
  }

  function handleCameraErrorChange() {
    var message;

    if (!camError.classList.contains('visible')) {
      return;
    }

    message = camError.textContent || '';
    decorateCurrentError();

    if (/caméra a été interrompue|caméra est interrompue/i.test(message)) {
      scheduleAutomaticRecovery();
    }
  }

  btnNewTake.addEventListener('click', function () {
    setTimeout(function () {
      if (!hasLiveVideoTrack(video.srcObject) || camError.classList.contains('visible')) {
        recoverCamera(true).catch(function () {
          // Le bouton de secours est affiché par recoverCamera().
        });
        return;
      }

      camError.classList.remove('visible');
      var playResult = video.play();
      if (playResult && typeof playResult.catch === 'function') {
        playResult.catch(function () {
          recoverCamera(true).catch(function () {});
        });
      }
    }, 80);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden &&
        (!hasLiveVideoTrack(video.srcObject) || camError.classList.contains('visible'))) {
      recoverCamera(true).catch(function () {});
    }
  });

  window.addEventListener('pageshow', function (event) {
    if (event.persisted && !hasLiveVideoTrack(video.srcObject)) {
      recoverCamera(true).catch(function () {});
    }
  });

  if (typeof MutationObserver === 'function') {
    new MutationObserver(handleCameraErrorChange).observe(camError, {
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  handleCameraErrorChange();
})();
