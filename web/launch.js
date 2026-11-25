const tabs = document.querySelector('.tour-tabs');
const buttons = [...tabs.querySelectorAll('.step')];
const panels = [...document.querySelectorAll('.preview-panel')];

function showPanel(selected) {
  for (const panel of panels) panel.hidden = panel.id !== selected.dataset.panel;
  for (const button of buttons) button.setAttribute('aria-pressed', String(button === selected));
}

for (const button of buttons) {
  button.addEventListener('click', () => showPanel(button));
  button.disabled = false;
}
showPanel(buttons[0]);
document.documentElement.classList.add('enhanced');
tabs.hidden = false;

const touchButton = document.querySelector('.touch-action');
const edge = document.querySelector('.edge-target');
const touchMenu = document.querySelector('#touch-menu');

function showTouchMenu(open) {
  touchMenu.hidden = !open;
  edge.setAttribute('aria-expanded', String(open));
  touchButton.setAttribute('aria-expanded', String(open));
  touchButton.textContent = open ? 'Close touch menu' : 'Open touch menu';
}

showTouchMenu(false);
for (const button of [touchButton, edge]) {
  button.addEventListener('click', () => showTouchMenu(touchMenu.hidden));
  button.disabled = false;
  button.hidden = false;
}

const moveButton = document.querySelector('.move-action');
const playbackButton = document.querySelector('.playback-action');
const note = document.querySelector('.note-window');
const macDisplay = document.querySelector('.mac-display');
const phoneDisplay = document.querySelector('.phone-display');
const workspaceStatus = document.querySelector('#workspace-status');
const devices = document.querySelector('#workspace .devices');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let demoPaused = false;
let devicesInView = false;
let demoTimer;
let dragAnimations = [];

function transformBetween(from, to) {
  return `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(${to.width / from.width}, ${to.height / from.height})`;
}

function finishDrag() {
  for (const animation of dragAnimations) animation.finish();
}

async function moveNote(toPhone, animate = true) {
  const destination = toPhone ? phoneDisplay : macDisplay;
  if (animate && !reducedMotion.matches && typeof note.animate === 'function') {
    // Each screen clips its own view of the window as it crosses the bezels.
    const start = note.getBoundingClientRect();
    const departing = note.cloneNode(true);
    departing.setAttribute('aria-hidden', 'true');
    note.replaceWith(departing);
    destination.append(note);
    const end = note.getBoundingClientRect();
    devices.classList.add('dragging');
    workspaceStatus.textContent = toPhone ? 'Moving to the phone…' : 'Moving back to the Mac…';
    const options = {duration: 1250, easing: 'cubic-bezier(.42,0,.22,1)', fill: 'both'};
    const rest = 'translate(0px, 0px) scale(1, 1)';
    dragAnimations = [
      departing.animate({transform: [rest, transformBetween(start, end)]}, options),
      note.animate({transform: [transformBetween(end, start), rest]}, options)
    ];
    await Promise.all(dragAnimations.map(animation => animation.finished));
    departing.remove();
    for (const animation of dragAnimations) animation.cancel();
    dragAnimations = [];
    devices.classList.remove('dragging');
  } else {
    destination.append(note);
  }
  moveButton.textContent = toPhone ? 'Move back to Mac' : 'Move window to phone';
  workspaceStatus.textContent = toPhone ? 'Shot list on the phone' : 'Shot list on the Mac';
  scheduleDemo();
}

function scheduleDemo() {
  clearTimeout(demoTimer);
  playbackButton.hidden = reducedMotion.matches || !('IntersectionObserver' in window);
  if (demoPaused || !devicesInView || document.hidden || reducedMotion.matches) {
    finishDrag();
    return;
  }
  if (dragAnimations.length) return;
  const toPhone = note.parentNode === macDisplay;
  demoTimer = setTimeout(() => {
    if (devices.closest('.preview-panel').hidden) return;
    moveNote(toPhone);
  }, toPhone ? 900 : 3000);
}

function setDemoPaused(paused) {
  demoPaused = paused;
  playbackButton.textContent = paused ? 'Resume animation' : 'Pause animation';
  workspaceStatus.setAttribute('aria-live', paused ? 'polite' : 'off');
  scheduleDemo();
}

moveNote(false, false);
playbackButton.addEventListener('click', () => setDemoPaused(!demoPaused));
moveButton.addEventListener('click', () => {
  setDemoPaused(true);
  if (!dragAnimations.length) moveNote(note.parentNode === macDisplay);
});
moveButton.disabled = false;
moveButton.hidden = false;

if ('IntersectionObserver' in window) {
  new IntersectionObserver(([entry]) => {
    devicesInView = entry.intersectionRatio >= .5;
    scheduleDemo();
  }, {threshold: .5}).observe(devices);
}
document.addEventListener('visibilitychange', scheduleDemo);
reducedMotion.addEventListener('change', scheduleDemo);
window.addEventListener('resize', finishDrag);
