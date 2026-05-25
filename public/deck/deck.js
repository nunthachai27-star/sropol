// public/deck/deck.js
// KK-LRMS MOPH Executive Deck — navigation + scaling
(function () {
  'use strict';

  // Main slides have id="slide-N" (N = 1..12). Backups have id="backup-N".
  const mainSlides = Array.from(document.querySelectorAll('.slide:not([id^="backup-"])'));
  const backupSlides = Array.from(document.querySelectorAll('.slide[id^="backup-"]'));
  const counter = document.querySelector('.slide-counter');

  let index = 0;
  let mode = 'main'; // 'main' or 'backup'

  function activeList() { return mode === 'main' ? mainSlides : backupSlides; }

  function refresh() {
    const list = activeList();
    document.querySelectorAll('.slide.is-active').forEach(s => s.classList.remove('is-active'));
    if (list[index]) list[index].classList.add('is-active');
    if (counter) counter.textContent =
      `${mode === 'backup' ? 'B' : ''}${index + 1} / ${list.length}`;
  }

  function scale() {
    const sw = 1920, sh = 1080;
    const vw = window.innerWidth, vh = window.innerHeight;
    const ratio = Math.min(vw / sw, vh / sh);
    document.querySelectorAll('.slide').forEach(s => { s.style.transform = `scale(${ratio})`; });
  }

  function next() { const list = activeList(); if (index < list.length - 1) { index++; refresh(); } }
  function prev() { if (index > 0) { index--; refresh(); } }
  function first() { index = 0; refresh(); }
  function last() { index = activeList().length - 1; refresh(); }

  function toggleBackup() {
    mode = mode === 'main' ? 'backup' : 'main';
    index = 0;
    refresh();
  }

  function toggleNotes() {
    const overlay = document.querySelector('.notes-overlay');
    if (!overlay) return;
    overlay.classList.toggle('is-visible');
    if (overlay.classList.contains('is-visible')) {
      const slide = activeList()[index];
      const id = slide ? slide.id : '';
      overlay.querySelectorAll('[data-note]').forEach(n => n.style.display = 'none');
      const note = overlay.querySelector(`[data-for="${id}"]`);
      if (note) note.style.display = 'block';
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    switch (e.key) {
      case 'ArrowRight':
      case ' ':
      case 'PageDown':
        e.preventDefault(); next(); break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault(); prev(); break;
      case 'Home':
        e.preventDefault(); first(); break;
      case 'End':
        e.preventDefault(); last(); break;
      case 'b':
      case 'B':
        e.preventDefault(); toggleBackup(); break;
      case 'n':
      case 'N':
        e.preventDefault(); toggleNotes(); break;
    }
  });

  // Click navigation: right half advances, left half retreats
  document.addEventListener('click', (e) => {
    if (e.target.closest('a, button, .no-click, .notes-overlay')) return;
    const half = window.innerWidth / 2;
    e.clientX > half ? next() : prev();
  });

  window.addEventListener('resize', scale);
  scale();
  refresh();
})();
