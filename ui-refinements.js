'use strict';

(function () {
  function load(src, onload) {
    const script = document.createElement('script');
    script.src = src;
    if (onload) script.addEventListener('load', onload, { once: true });
    document.head.appendChild(script);
  }

  function loadReceiptForm() {
    if (document.querySelector('script[data-ledger-receipt-modal]')) return;
    const script = document.createElement('script');
    script.src = 'ledger-receipt-modal.js?v=ledger-receipts-v3';
    script.dataset.ledgerReceiptModal = 'true';
    document.head.appendChild(script);
  }

  load('ui-refinements-core.js?v=ledger-receipts-v2', () => {
    // app.js is a deferred classic script. Wait until its global modal API is
    // definitely available before installing the Ledger receipt form hook.
    if (typeof window.openModal === 'function') loadReceiptForm();
    else window.addEventListener('load', loadReceiptForm, { once: true });
  });
}());
