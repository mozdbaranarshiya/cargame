// Load the independently maintained game modules and surface initialization failures in the menu.
if (!/^\/admin\/?$/.test(window.location.pathname)) import('./scripts/game/engine.js').catch(error => {
  console.error('Game initialization failed:', error);
  const message = 'نمایش سه‌بعدی بازی اجرا نشد. مرورگر دارای WebGL و شتاب‌دهی گرافیکی را امتحان کن.';
  window.dispatchEvent(new CustomEvent('game-error', { detail: { message } }));
});
