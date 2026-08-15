'use strict';

(function () {
  function load(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    if (onload) script.addEventListener('load', onload, { once: true });
    document.head.appendChild(script);
  }

  load('ui-refinements-core.js?v=ledger-receipts-v2', () => {
    load('ledger-receipt-modal.js?v=ledger-receipts-v2');
  });
}());
