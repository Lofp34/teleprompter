/*
 * warmup.js — échauffement express de diction et d'amplification vocale.
 * Le module reste entièrement local et n'altère jamais le texte du prompteur.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'teleprompter.warmup.v1';
  var SWIPE_THRESHOLD_PX = 46;

  // Reprise fidèle, dans l'ordre, des exercices publiés par ATA Théâtre,
  // du premier exercice jusqu'à celui de l'Américain. Le doublon exact de
  // « La cavale au Valaque… » présent sur la page source n'est affiché qu'une fois.
  var DICTION_EXERCISES = [
    "Sage chasseur âgé aux yeux chassieux, sachez chasser sans chien chose aisée, ce chat chauve caché sous ces six chiches souches de sauge sèche.",
    "Alerte, Arlette allaite !",
    "Un gradé dragon dégrade un dragon gradé",
    "Trois très gros, gras, grands rats gris grattent",
    "Trois sorcières suédoises et transsexuelles regardent les boutons de trois montres Swatch suisses. Quelle sorcière suédoise transsexuelle regarde quel bouton de quelle montre Swatch suisse ?",
    "Mur gâté, trou s'y fit, rat s'y mit",
    "Cinq capucins portaient sur leur sein le sein du saint-père",
    "Pour qui sont ces serpents qui sifflent sur vos têtes ?",
    "Six slips chics, six chics slips",
    "Papa boit dans les pins. Papa peint dans les bois. Dans les bois, papa boit et peint",
    "Donne-lui à minuit huit fruits cuits et si ces huit fruits cuits lui nuisent, donne lui huit fruits crus",
    "La cavale au Valaque avala l'eau du lac. L'eau du lac lava la cavale au Valaque",
    "Le pragmatisme de l'astigmate agace",
    "Je veux et j'exige dix-huit chemises fines et six fichus fins !",
    "Le fisc fixe exprès chaque taxe fixe excessive exclusivement au luxe et à l'exquis",
    "Dis-moi, petite pomme, quand te dépetitepommeras-tu ?Je me dépetitepommerai quand toutes les petites pommes se dépetitepommeront. Or, comme toutes les petites pommes ne se dépetitepommeront jamais, petite pomme ne se dépetitepommera, jamais",
    "Un ange qui songeait à changer son visage pour donner le change, se vit si changé, que loin de louanger ce changement, il jugea que tous les autres anges jugeraient que jamais ange ainsi changé ne rechangerait jamais, et jamais plus ange ne songea à se changer",
    "Très grand doreur, quand redoreras-tu sûrement et d'un goût rare mes trente trois ou trente quatre cuillères d'or trop argentées ? Je redorerai sûrement quatre grandes cuillères d'or trop argentées, quand j'aurai redoré sûrement et d'un goût rare tes trente trois ou trente quatre autres grandes cuillères d'or trop argentées",
    "Quand un cordier cordant veut corder une corde, pour sa corde corder,trois cordon il accorde. Mais si l'un des cordons de la corde décorde, le cordon décordant fait décorder la corde",
    "Rat vit rôt, rôt tenta rat, rat mit patte à rôt, rot brûla pattes à rat, rat secoua pattes et quitta rôt",
    "J'ai un point dans mon pourpoint qui me pique et qui me pointe, si je savais celui qui a mis ce point dans mon pourpoint qui me pique et qui nie pointe, je lui mettrais un point dans son pourpoint qui le pique et qui le pointe",
    "Si l 'Américain se désaméricaniserait comment le réaméricaniserions-nous, l'Américain ? On le réaméricaniserait comme on l'a désaméricanisé, l'Américain"
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
