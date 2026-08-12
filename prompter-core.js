/*
 * prompter-core.js — logique pure du prompteur.
 * Compatible navigateur (global PrompterCore) et Node (module.exports)
 * pour permettre les tests synthétiques sans navigateur.
 * Aucune donnée réelle, aucun accès réseau.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PrompterCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_SPEED = 120;    // pixels par seconde
  var MIN_SPEED = 20;
  var MAX_SPEED = 240;
  var MIN_FONT = 20;
  var MAX_FONT = 96;
  var DEFAULT_FONT = 48;
  var MIN_OPACITY = 0.1;
  var MAX_OPACITY = 1;
  var DEFAULT_OPACITY = 0.85;
  var MAX_COUNTDOWN = 10;

  function clamp(value, min, max, fallback) {
    var n = Number(value);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, n));
  }

  /**
   * Découpe le texte en paragraphes normalisés et non vides.
   * Chaque retour à la ligne devient un paragraphe ; les espaces multiples
   * sont réduits à un seul espace.
   */
  function buildParagraphs(text) {
    if (typeof text !== 'string') {
      return [];
    }
    return text
      .split(/\r?\n/)
      .map(function (p) { return p.replace(/\s+/g, ' ').trim(); })
      .filter(function (p) { return p.length > 0; });
  }

  function countWords(paragraphs) {
    if (!Array.isArray(paragraphs)) {
      return 0;
    }
    return paragraphs.reduce(function (sum, p) {
      return sum + p.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
    }, 0);
  }

  function formatElapsed(ms) {
    var total;
    if (!Number.isFinite(ms) || ms < 0) {
      total = 0;
    } else {
      total = Math.floor(ms / 1000);
    }
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function clampSpeed(value) {
    return clamp(value, MIN_SPEED, MAX_SPEED, DEFAULT_SPEED);
  }

  function clampFontSize(value) {
    return clamp(value, MIN_FONT, MAX_FONT, DEFAULT_FONT);
  }

  function clampOpacity(value) {
    return clamp(value, MIN_OPACITY, MAX_OPACITY, DEFAULT_OPACITY);
  }

  function clampCountdown(value) {
    return Math.round(clamp(value, 0, MAX_COUNTDOWN, 3));
  }

  /**
   * Parse une saisie de vitesse (px/s), accepte la virgule décimale,
   * retourne un entier borné ou la valeur par défaut (y compris vide).
   */
  function parseSpeedInput(str) {
    var s = String(str).trim();
    if (s === '') {
      return DEFAULT_SPEED;
    }
    var n = Number(s.replace(',', '.'));
    if (!Number.isFinite(n)) {
      return DEFAULT_SPEED;
    }
    return Math.round(clampSpeed(n));
  }

  /**
   * Position de défilement en pixels pour un temps écoulé donné.
   * Bornée entre 0 et maxScroll ; maxScroll <= 0 signifie texte court
   * ou non mesuré (position nulle).
   */
  function scrollPositionAt(elapsedMs, speedPxPerSec, maxScroll) {
    var limit = Math.max(0, maxScroll || 0);
    if (limit === 0) {
      return 0;
    }
    var pos = (Math.max(0, elapsedMs || 0) / 1000) * speedPxPerSec;
    return Math.min(pos, limit);
  }

  function isAtEnd(pos, maxScroll) {
    var limit = Math.max(0, maxScroll || 0);
    return limit > 0 && pos >= limit - 0.5;
  }

  return {
    DEFAULT_SPEED: DEFAULT_SPEED,
    MIN_SPEED: MIN_SPEED,
    MAX_SPEED: MAX_SPEED,
    DEFAULT_FONT: DEFAULT_FONT,
    DEFAULT_OPACITY: DEFAULT_OPACITY,
    buildParagraphs: buildParagraphs,
    countWords: countWords,
    formatElapsed: formatElapsed,
    clampSpeed: clampSpeed,
    clampFontSize: clampFontSize,
    clampOpacity: clampOpacity,
    clampCountdown: clampCountdown,
    parseSpeedInput: parseSpeedInput,
    scrollPositionAt: scrollPositionAt,
    isAtEnd: isAtEnd
  };
});
