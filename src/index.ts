import { VisibilityState, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { PalmSystem } from './palm-system.js';
import { sfx } from './sfx.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then(async (world) => {
  world.registerSystem(PalmSystem);

  // A plain, always-visible launch button so nobody depends on the browser's
  // own XR offer UI to get in.
  const button = document.getElementById('enter') as HTMLButtonElement;
  const hint = document.getElementById('hint') as HTMLParagraphElement;
  let supported = false;
  try {
    supported = !!(await navigator.xr?.isSessionSupported('immersive-ar'));
  } catch {
    supported = false;
  }
  if (supported) {
    button.style.display = 'block';
    hint.textContent = 'Hands only. Sit comfortably and put your controllers down.';
    button.addEventListener('click', () => {
      sfx.unlock();
      world.launchXR();
    });
  } else {
    hint.textContent = 'Open this page in the Meta Quest browser to play.';
  }
  world.visibilityState.subscribe((state) => {
    document.body.classList.toggle('in-xr', state !== VisibilityState.NonImmersive);
  });
});
