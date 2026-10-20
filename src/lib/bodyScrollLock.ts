let lockDepth = 0;
let savedScrollY = 0;

export function lockBodyScroll(): void {
  if (lockDepth === 0) {
    savedScrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
  }
  lockDepth++;
}

export function unlockBodyScroll(): void {
  if (lockDepth > 0) lockDepth--;
  if (lockDepth === 0) {
    document.body.style.overflow = '';
  }
}

export function resetBodyScrollLock(): void {
  lockDepth = 0;
  document.body.style.overflow = '';
}
