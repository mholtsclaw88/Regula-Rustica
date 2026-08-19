'use strict';
(function(){
 const today=document.querySelector('#today');
 if(!today||today.dataset.dashboardRefined==='true')return;
 today.dataset.dashboardRefined='true';
 const chores=document.querySelector('#todayChoreWindows');
 const grid=today.querySelector(':scope > .grid2');
 const work=document.querySelector('#todayTasks')?.closest('.card');
 const glance=document.querySelector('#openCount')?.closest('.card');
 const events=document.querySelector('#todayEvents')?.closest('.card');
 const date=document.querySelector('#todayDate');
 if(!chores||!grid||!work||!glance||!events||!date)return;

 const head=document.createElement('div');
 head.className='today-dashboard-head';
 const eyebrow=document.createElement('span');
 eyebrow.className='label';eyebrow.textContent='Today at Woodthief Homestead';
 date.classList.add('today-dashboard-date');
 head.append(eyebrow,date);
 today.insertBefore(head,chores);

 glance.classList.add('today-glance');
 const glanceLabel=glance.querySelector('.label');if(glanceLabel)glanceLabel.textContent='Today at a glance';
 today.insertBefore(glance,chores);
 const stats=[...glance.querySelectorAll('.stat')];
 if(stats[0])stats[0].querySelector('span').textContent='Completed';
 if(stats[1])stats[1].querySelector('span').textContent='Remaining';
 if(stats[2])stats[2].querySelector('span').textContent='Events';
 const completedEl=stats[0]?.querySelector('strong'),remainingEl=stats[1]?.querySelector('strong'),eventsEl=stats[2]?.querySelector('strong');

 function taskKey(row){const title=row.querySelector('.task-title')?.textContent?.trim()||'';const meta=row.querySelector('.record-task-meta,.meta-pills')?.textContent?.trim()||'';return `${title}|${meta}`;}
 function refreshGlance(){const rows=[...document.querySelectorAll('#todayChoreWindows .task,#todayTasks .task')];const unique=new Map();rows.forEach(row=>{const key=taskKey(row);if(key&&!unique.has(key))unique.set(key,row);});let completed=0;unique.forEach(row=>{const check=row.querySelector('input[type="checkbox"]');if(row.classList.contains('done')||check?.checked)completed++;});if(completedEl)completedEl.textContent=String(completed);if(remainingEl)remainingEl.textContent=String(Math.max(0,unique.size-completed));if(eventsEl)eventsEl.textContent=String(document.querySelectorAll('#todayEvents > :not(.empty)').length||Number(document.querySelector('#todayEventCount')?.textContent)||0);}

 function makeCollapsible(card,bodyNodes,key){if(!card||card.dataset.todayCollapsible==='true')return;card.dataset.todayCollapsible='true';card.classList.add('today-collapsible');const body=document.createElement('div');body.className='today-collapsible-body';bodyNodes.filter(Boolean).forEach(node=>body.appendChild(node));card.appendChild(body);const button=document.createElement('button');button.type='button';button.className='today-collapsible-toggle';button.setAttribute('aria-label','Collapse section');button.textContent='⌄';card.appendChild(button);const stored=sessionStorage.getItem(`rr-today-${key}`);if(stored==='collapsed')card.classList.add('collapsed');const sync=()=>{const collapsed=card.classList.contains('collapsed');button.setAttribute('aria-expanded',String(!collapsed));button.setAttribute('aria-label',collapsed?'Expand section':'Collapse section');};button.addEventListener('click',()=>{card.classList.toggle('collapsed');sessionStorage.setItem(`rr-today-${key}`,card.classList.contains('collapsed')?'collapsed':'open');sync();});sync();}
 const workLabel=work.querySelector('.label');if(workLabel)workLabel.textContent="Today's Work";
 makeCollapsible(work,[document.querySelector('#todayTasks'),document.querySelector('#todayEmpty'),document.querySelector('#todayTaskCount')],'work');
 makeCollapsible(events,[document.querySelector('#todayEvents'),document.querySelector('#todayEventsEmpty')],'events');

 function refineChoreCards(){chores.querySelectorAll('article,.card').forEach((card,index)=>{if(card.dataset.todayChoreToggle==='true')return;card.dataset.todayChoreToggle='true';const existing=card.querySelector('summary');if(existing)return;const taskContainer=card.querySelector('.stack')||card.querySelector('[class*=tasks]');if(!taskContainer)return;makeCollapsible(card,[taskContainer],`chore-${index}`);});}
 const observer=new MutationObserver(()=>{refineChoreCards();refreshGlance();});
 observer.observe(today,{childList:true,subtree:true,attributes:true,attributeFilter:['class','checked']});
 refineChoreCards();refreshGlance();
}());