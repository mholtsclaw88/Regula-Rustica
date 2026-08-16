'use strict';
(function(){
 function load(src,onload,marker){if(marker&&document.querySelector(`script[${marker}]`))return;const script=document.createElement('script');script.src=src;if(marker)script.setAttribute(marker,'true');if(onload)script.addEventListener('load',onload,{once:true});document.head.appendChild(script);}
 function loadLedgerTools(){load('ledger-receipt-modal.js?v=ledger-receipts-v3',null,'data-ledger-receipt-modal');load('ledger-allocations.js?v=allocations-v1',null,'data-ledger-allocations');}
 load('ui-refinements-core.js?v=ledger-receipts-v2',()=>{if(typeof window.openModal==='function')loadLedgerTools();else window.addEventListener('load',loadLedgerTools,{once:true});});
}());
