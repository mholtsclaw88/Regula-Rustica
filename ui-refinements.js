'use strict';
(function(){
 function load(src,onload,marker){if(marker&&document.querySelector(`script[${marker}]`))return;const script=document.createElement('script');script.src=src;if(marker)script.setAttribute(marker,'true');if(onload)script.addEventListener('load',onload,{once:true});document.head.appendChild(script);}
 function loadLedgerTools(){load('ledger-receipt-modal.js?v=ledger-form-v1',null,'data-ledger-receipt-modal');load('ledger-allocations.js?v=ledger-form-v1',null,'data-ledger-allocations');load('ledger-allocation-display.js?v=reporting-v1',null,'data-ledger-allocation-display');}
 load('ui-refinements-core.js?v=record-ui-v1',()=>{if(typeof window.openModal==='function')loadLedgerTools();else window.addEventListener('load',loadLedgerTools,{once:true});});
}());
