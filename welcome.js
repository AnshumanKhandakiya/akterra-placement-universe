const writingObserver=new IntersectionObserver(entries=>{
  entries.forEach(entry=>{
    if(entry.isIntersecting){
      writeElement(entry.target);
    }else{
      entry.target.classList.remove('is-writing');
    }
  });
},{threshold:.16,rootMargin:'0px 0px -5% 0px'});

function prepareWriting(element){
  if(element.dataset.inkPrepared)return;
  element.dataset.inkPrepared='true';
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
  const textNodes=[];
  while(walker.nextNode())textNodes.push(walker.currentNode);
  let index=0;
  textNodes.forEach(node=>{
    const fragment=document.createDocumentFragment();
    Array.from(node.nodeValue).forEach(character=>{
      const letter=document.createElement('span');
      letter.className='ink-char';
      letter.style.setProperty('--ink-delay',`${Math.min(index*.004,0.28)}s`);
      letter.textContent=character;
      fragment.appendChild(letter);
      index++;
    });
    node.parentNode.replaceChild(fragment,node);
  });
  const nail=document.createElement('span');
  nail.className='nail-cursor';
  nail.setAttribute('aria-hidden','true');
  nail.style.setProperty('--nail-delay',`${Math.min(index*.004,0.28)}s`);
  element.appendChild(nail);
  element.classList.add('ink-prepared');
}

function writeElement(element){
  prepareWriting(element);
  element.classList.add('is-writing');
}

document.querySelectorAll('.writing-target').forEach(element=>{
  prepareWriting(element);
  writingObserver.observe(element);
});

const storyTabs=[...document.querySelectorAll('.story-tab')];
function openStoryTab(tab){storyTabs.forEach(item=>{const open=item===tab;item.classList.toggle('is-open',open);item.setAttribute('aria-expanded',String(open))});const extra=tab.querySelector('.story-extra');if(extra)writeElement(extra)}
storyTabs.forEach(tab=>{
  tab.addEventListener('pointerenter',()=>openStoryTab(tab));
  tab.addEventListener('focus',()=>openStoryTab(tab));
  tab.addEventListener('click',()=>openStoryTab(tab));
});

const roleMessages={
  college:'The College Admin portal will support separate college workspaces, placement teams, and campus level management.',
  company:'The Company portal will help recruiters share opportunities and manage candidates across participating colleges.',
  student:'The Student portal will help students explore roles, track applications, and keep their placement profile ready.'
};
const toastRegion=document.getElementById('toast-region');
let toastTimer;
document.querySelectorAll('[data-role]').forEach(button=>{
  button.addEventListener('click',()=>{
    const role=button.dataset.role;
    if(role==='student'){
      document.dispatchEvent(new CustomEvent('student-portal:open'));
      return;
    }
    if(role==='college'){
      document.dispatchEvent(new CustomEvent('college-portal:open'));
      return;
    }
    if(role==='company'){
      document.dispatchEvent(new CustomEvent('company-portal:open'));
      return;
    }
    toastRegion.innerHTML=`<div class="toast"><button class="toast-dismiss" aria-label="Dismiss">&times;</button><b>${button.dataset.label} sign-in selected.</b> ${roleMessages[role]} The sign-in window will be designed next.</div>`;
    toastRegion.querySelector('.toast-dismiss').addEventListener('click',()=>toastRegion.replaceChildren());
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>toastRegion.replaceChildren(),7000);
  });
});

const leaderboardHelpButton=document.getElementById('leaderboard-help-button');
const leaderboardHelpPanel=document.getElementById('leaderboard-help-panel');
leaderboardHelpButton?.addEventListener('click',()=>{
  const expanded=leaderboardHelpButton.getAttribute('aria-expanded')==='true';
  leaderboardHelpButton.setAttribute('aria-expanded',String(!expanded));
  leaderboardHelpPanel.hidden=expanded;
});

function escapeLeaderboardText(value=''){
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
async function loadPublicLeaderboard(){
  const rowsElement=document.getElementById('public-leaderboard-rows');
  if(!rowsElement)return;
  try{
    const response=await fetch('/api/leaderboard',{credentials:'same-origin'});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'Could not load rankings.');
    rowsElement.innerHTML=result.rows.map(row=>{
      const placementCount=Number(row.placementCount)||0;
      const rate=row.placementRatePercent===null?'Class size needed':`${Number(row.placementRatePercent).toFixed(1)}%`;
      const average=row.packageAverageSuppressed?(placementCount?'Private until 5 rated placements':'—'):`₹${Number(row.averagePackageLpa).toFixed(2)} LPA`;
      const rating=row.score===null?'—':`${Number(row.score).toFixed(1)}${row.scoreStatus==='provisional'?'*':''}`;
      const rank=row.rank===null?'—':row.rank;
      return `<tr><td><span class="leader-rank">${rank}</span></td><td>${escapeLeaderboardText(row.collegeName)}</td><td>${placementCount}</td><td>${rate}</td><td>${average}</td><td><span class="leader-score">${rating}</span></td></tr>`;
    }).join('')||'<tr><td colspan="6" class="placement-empty">Rankings will appear when colleges are registered.</td></tr>';
  }catch{
    rowsElement.innerHTML='<tr><td colspan="6" class="placement-empty">Start the Akterra server to load college rankings.</td></tr>';
  }
}
window.addEventListener('akterra:leaderboard-updated',loadPublicLeaderboard);
loadPublicLeaderboard();

