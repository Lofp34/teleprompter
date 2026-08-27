/*
 * warmup.js — échauffement express de diction et d'amplification vocale.
 * Le module reste entièrement local et n'altère jamais le texte du prompteur.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'teleprompter.warmup.v1';
  var SWIPE_THRESHOLD_PX = 46;

  var DICTION_EXERCISES = [
    'Chez Chloé, six chats chassent sans bruit sous six chênes.',
    'Arlette alerte Alain avant l’aube.',
    'Le dragon doré déroule doucement ses draps.',
    'Trois gros rats gris grignotent trois grains ronds.',
    'Six Suissesses sages choisissent chacune six sachets.',
    'Sur le mur mûr, un rat remue près d’un trou.',
    'Cinq capucins cachent cinq capes couleur cuivre.',
    'Ces serpents sifflants glissent sous sept sapins.',
    'Six slips souples sèchent sur six fils solides.',
    'Paul peint un pin pendant que Pierre boit.',
    'Dans le bois, Paul peint puis pose son pinceau.',
    'Huit fruits cuits refroidissent dans huit petits plats.',
    'La jument du lac lape l’eau claire.',
    'L’eau claire du lac lave les longues jambes de la jument.',
    'Le pragmatique astigmate agace Agathe.',
    'J’exige dix chemises fines et dix fichus framboise.',
    'Le fisc fixe six taxes strictes sur six luxes exquis.',
    'Petite prune, quand te dépetitepruneras-tu ?',
    'Un ange songe à changer de visage sans jamais se décourager.',
    'Grand doreur, redore trente-trois cuillères trop argentées.',
    'Quand le cordier corde sa corde, trois cordons se décordent.',
    'Rat voit rôti, rôti tente rat, rat retire vite sa patte.',
    'Un point dans mon pourpoint me pique et me pointe.',
    'Trois très stricts statisticiens trient trente statistiques.',
    'Si l’Américain se désaméricaniserait, comment le réaméricaniserions-nous, l’Américain ?'
  ];

  var VOICE_STEPS = [
    {
      title: 'Voix posée',
      instruction: 'Prononcez chaque syllabe séparément, à volume confortable, en ouvrant bien la bouche.'
    },
    {
      title: 'Voix projetée',
      instruction: 'Envoyez chaque série vers un point éloigné, sans pousser la gorge ni crier.'
    },
    {
      title: 'Crescendo maîtrisé',
      instruction: 'Commencez doucement, augmentez progressivement, puis relâchez sur la dernière syllabe.'
    }
  ];

  var state = {
    tab: 'diction',
    dictionIndex: 0,
    voiceStep: 0,
    swipeStartX: null,
    opener: null
  };

  var els = {
    trigger: document.getElementById('btnFullscreen'),
    modal: document.getElementById('warmupModal'),
    close: document.getElementById('btnCloseWarmup'),
    done: document.getElementById('btnWarmupDone'),
    tabDiction: document.getElementById('warmupTabDiction'),
    tabVoice: document.getElementById('warmupTabVoice'),
    panelDiction: document.getElementById('warmupDictionPanel'),
    panelVoice: document.getElementById('warmupVoicePanel'),
    dictionCounter: document.getElementById('dictionCounter'),
    dictionProgress: document.getElementById('dictionProgress'),
    dictionPhrase: document.getElementById('dictionPhrase'),
    dictionCard: document.getElementById('dictionCard'),
    previousDiction: document.getElementById('btnPreviousDiction'),
    nextDiction: document.getElementById('btnNextDiction'),
    randomDiction: document.getElementById('btnRandomDiction'),
    voiceCounter: document.getElementById('voiceCounter'),
    voiceProgress: document.getElementById('voiceProgress'),
    voiceTitle: document.getElementById('voiceStepTitle'),
    voiceInstruction: document.getElementById('voiceInstruction'),
    previousVoice: document.getElementById('btnPreviousVoice'),
    nextVoice: document.getElementById('btnNextVoice')
  };

  function elementsAvailable() {
    return Object.keys(els).every(function (key) {
      return Boolean(els[key]);
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.tab === 'voice' || saved.tab === 'diction') {
        state.tab = saved.tab;
      }
      state.dictionIndex = clamp(Number(saved.dictionIndex) || 0, 0, DICTION_EXERCISES.length - 1);
    } catch (err) {
      // Le module fonctionne aussi lorsque le stockage local est indisponible.
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        tab: state.tab,
        dictionIndex: state.dictionIndex
      }));
    } catch (err) {
      // Rien à faire : l'échauffement reste utilisable en mémoire.
    }
  }

  function isOpen() {
    return !els.modal.hidden;
  }

  function setTab(tab) {
    state.tab = tab === 'voice' ? 'voice' : 'diction';
    var dictionActive = state.tab === 'diction';

    els.tabDiction.setAttribute('aria-selected', String(dictionActive));
    els.tabVoice.setAttribute('aria-selected', String(!dictionActive));
    els.tabDiction.tabIndex = dictionActive ? 0 : -1;
    els.tabVoice.tabIndex = dictionActive ? -1 : 0;
    els.panelDiction.hidden = !dictionActive;
    els.panelVoice.hidden = dictionActive;

    if (dictionActive) {
      renderDiction();
    } else {
      renderVoice();
    }
    saveState();
  }

  function renderDiction() {
    var number = state.dictionIndex + 1;
    var progress = (number / DICTION_EXERCISES.length) * 100;
    els.dictionCounter.textContent = number + ' / ' + DICTION_EXERCISES.length;
    els.dictionProgress.style.width = progress.toFixed(2) + '%';
    els.dictionPhrase.textContent = DICTION_EXERCISES[state.dictionIndex];
    els.previousDiction.disabled = state.dictionIndex === 0;
    els.nextDiction.textContent = state.dictionIndex === DICTION_EXERCISES.length - 1 ?
      'Recommencer ↻' :
      'Suivante →';
    els.dictionCard.scrollTop = 0;
  }

  function changeDiction(delta) {
    var next = state.dictionIndex + delta;
    if (next >= DICTION_EXERCISES.length) {
      next = 0;
    }
    state.dictionIndex = clamp(next, 0, DICTION_EXERCISES.length - 1);
    renderDiction();
    saveState();
  }

  function randomDiction() {
    if (DICTION_EXERCISES.length <= 1) {
      return;
    }
    var next = state.dictionIndex;
    while (next === state.dictionIndex) {
      next = Math.floor(Math.random() * DICTION_EXERCISES.length);
    }
    state.dictionIndex = next;
    renderDiction();
    saveState();
  }

  function renderVoice() {
    var step = VOICE_STEPS[state.voiceStep];
    var number = state.voiceStep + 1;
    els.voiceCounter.textContent = number + ' / ' + VOICE_STEPS.length;
    els.voiceProgress.style.width = ((number / VOICE_STEPS.length) * 100).toFixed(2) + '%';
    els.voiceTitle.textContent = step.title;
    els.voiceInstruction.textContent = step.instruction;
    els.previousVoice.disabled = state.voiceStep === 0;
    els.nextVoice.textContent = state.voiceStep === VOICE_STEPS.length - 1 ?
      'Recommencer ↻' :
      'Étape suivante →';
  }

  function changeVoice(delta) {
    var next = state.voiceStep + delta;
    if (next >= VOICE_STEPS.length) {
      next = 0;
    }
    state.voiceStep = clamp(next, 0, VOICE_STEPS.length - 1);
    renderVoice();
  }

  function openWarmup() {
    if (window.TeleprompterApp && typeof window.TeleprompterApp.pauseScroll === 'function') {
      window.TeleprompterApp.pauseScroll();
    }
    state.opener = document.activeElement;
    els.modal.hidden = false;
    els.modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('warmup-open');
    setTab(state.tab);
    window.setTimeout(function () {
      els.close.focus();
    }, 0);
  }

  function closeWarmup() {
    els.modal.hidden = true;
    els.modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('warmup-open');
    saveState();

    var focusTarget = state.opener && typeof state.opener.focus === 'function' ?
      state.opener : els.trigger;
    state.opener = null;
    focusTarget.focus();
  }

  function interceptTrigger(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openWarmup();
  }

  function handleKeydown(event) {
    if (!isOpen()) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeWarmup();
      return;
    }

    if (event.key === '1') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setTab('diction');
      return;
    }

    if (event.key === '2') {
      event.preventDefault();
      event.stopImmediatePropagation();
      setTab('voice');
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopImmediatePropagation();
      var delta = event.key === 'ArrowRight' ? 1 : -1;
      if (state.tab === 'diction') {
        changeDiction(delta);
      } else {
        changeVoice(delta);
      }
      return;
    }

    if (event.key === ' ' || event.code === 'Space') {
      event.stopImmediatePropagation();
    }
  }

  function beginSwipe(event) {
    state.swipeStartX = event.clientX;
  }

  function endSwipe(event) {
    if (state.swipeStartX === null) {
      return;
    }
    var distance = event.clientX - state.swipeStartX;
    state.swipeStartX = null;
    if (Math.abs(distance) < SWIPE_THRESHOLD_PX) {
      return;
    }
    changeDiction(distance < 0 ? 1 : -1);
  }

  function bindEvents() {
    // Le bouton garde son ancien identifiant pour ne pas casser app.js.
    // La capture intercepte le clic avant l'ancien gestionnaire plein écran.
    els.trigger.addEventListener('click', interceptTrigger, true);
    els.close.addEventListener('click', closeWarmup);
    els.done.addEventListener('click', closeWarmup);
    els.tabDiction.addEventListener('click', function () { setTab('diction'); });
    els.tabVoice.addEventListener('click', function () { setTab('voice'); });
    els.previousDiction.addEventListener('click', function () { changeDiction(-1); });
    els.nextDiction.addEventListener('click', function () { changeDiction(1); });
    els.randomDiction.addEventListener('click', randomDiction);
    els.previousVoice.addEventListener('click', function () { changeVoice(-1); });
    els.nextVoice.addEventListener('click', function () { changeVoice(1); });
    els.dictionCard.addEventListener('pointerdown', beginSwipe);
    els.dictionCard.addEventListener('pointerup', endSwipe);
    els.dictionCard.addEventListener('pointercancel', function () {
      state.swipeStartX = null;
    });
    els.modal.addEventListener('click', function (event) {
      if (event.target === els.modal) {
        closeWarmup();
      }
    });
    document.addEventListener('keydown', handleKeydown, true);
  }

  function init() {
    if (!elementsAvailable()) {
      return;
    }
    loadState();
    renderDiction();
    renderVoice();
    setTab(state.tab);
    bindEvents();
  }

  window.TeleprompterWarmup = {
    open: openWarmup,
    close: closeWarmup
  };

  init();
})();
