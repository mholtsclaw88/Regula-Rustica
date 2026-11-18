// Use native lifecycle events. A Promise-returning waitForFunction predicate is
// truthy before its boolean resolves in the pinned Playwright runtime.
export async function waitForControlledWorker(page, timeout = 30_000) {
  await page.evaluate(timeout => new Promise((resolve, reject) => {
    let registration, observed, finished = false;
    const container = navigator.serviceWorker;
    const finish = error => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      container.removeEventListener('controllerchange', check);
      registration?.removeEventListener('updatefound', check);
      observed?.removeEventListener('statechange', check);
      if (error) reject(error); else resolve();
    };
    const check = () => {
      const active = registration?.active;
      if (observed !== active) {
        observed?.removeEventListener('statechange', check);
        observed = active;
        observed?.addEventListener('statechange', check);
      }
      const controller = container.controller;
      if (active?.state === 'activated' && controller?.state === 'activated'
        && controller.scriptURL === active.scriptURL) finish();
    };
    const timer = setTimeout(() => finish(new Error('Worker activation and control did not finish before reload')), timeout);
    container.addEventListener('controllerchange', check);
    container.ready.then(value => {
      if (finished) return;
      registration = value;
      registration.addEventListener('updatefound', check);
      check();
    }, finish);
  }), timeout);
}
