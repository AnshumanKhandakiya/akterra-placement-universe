const companyAuthRoot=document.getElementById('company-auth-root');
let companyAuthMode='login';
function validCompanyEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim())}
async function companyRequest(path,{method='POST',body}={}){
  if(location.protocol==='file:')throw new Error('Open Akterra through the local server to use company login.');
  let response;
  try{response=await fetch(`/api/company/${path}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'})}
  catch{throw new Error('Cannot reach the Akterra server. Double-click start-akterra.bat in the project folder and keep its server window open.')}
  let result={};try{result=await response.json()}catch{}
  if(!response.ok)throw new Error(result.error||'Something went wrong. Please try again.');
  return result;
}
function openCompanyPortal(){companyAuthMode='login';renderCompanyWindow()}
function renderCompanyWindow(){
  companyAuthRoot.innerHTML=`<div class="auth-stage company-stage" id="company-stage">
    <button class="auth-dismiss-layer" type="button" aria-label="Close company portal" data-company-close></button>
    <div class="blood-flow" aria-hidden="true"><i class="blood-rush rush-top"></i><i class="blood-rush rush-right"></i><i class="blood-rush rush-bottom"></i><i class="blood-rush rush-left"></i></div>
    <section class="auth-window company-window" role="dialog" aria-modal="true" aria-labelledby="company-auth-title">
      <header class="auth-header"><div><div class="auth-eyebrow">AKTERRA &middot; COMPANY ACCESS</div><h2 id="company-auth-title">Company portal</h2><p>Connect your team with college placement offices.</p></div><button class="auth-close" type="button" aria-label="Close" data-company-close>&times;</button></header>
      <div class="auth-tabs" role="tablist" aria-label="Company account options"><button class="auth-tab" type="button" role="tab" data-company-mode="login">Log in</button><button class="auth-tab" type="button" role="tab" data-company-mode="register">New registration</button></div>
      <div class="auth-panel" id="company-auth-panel"></div>
      <div class="auth-footnote"><span class="auth-lock" aria-hidden="true">&#9670;</span> Use a company email and a password created for Akterra.</div>
    </section>
  </div>`;
  companyAuthRoot.querySelectorAll('[data-company-close]').forEach(button=>button.addEventListener('click',closeCompanyWindow));
  companyAuthRoot.querySelectorAll('[data-company-mode]').forEach(button=>button.addEventListener('click',()=>{companyAuthMode=button.dataset.companyMode;renderCompanyPanel()}));
  renderCompanyPanel();
  companyAuthRoot.querySelector('[data-company-mode="login"]').focus({preventScroll:true});
}
function renderCompanyPanel(){
  const panel=document.getElementById('company-auth-panel');if(!panel)return;
  companyAuthRoot.querySelectorAll('[data-company-mode]').forEach(button=>{const active=button.dataset.companyMode===companyAuthMode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});
  if(companyAuthMode==='login')renderCompanyLogin(panel);else renderCompanyRegistration(panel);
}
function renderCompanyLogin(panel){
  panel.innerHTML=`<form class="auth-form" id="company-login-form" novalidate>
    <label class="auth-field"><span>Company official email or project admin username</span><input name="email" type="text" autocomplete="username" placeholder="name@company.com or admin username" required /></label>
    <label class="auth-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Your Akterra password" required /></label>
    <small class="demo-access-hint">Use the shared project admin demo login here; enter its username above.</small>
    <div class="auth-message" id="company-login-message" role="status"></div>
    <button class="auth-submit" type="submit"><span>Enter company portal</span><b aria-hidden="true">&rarr;</b></button>
    <p class="auth-switch">First time here? <button type="button" data-company-mode="register">Register your company</button></p>
  </form>`;
  panel.querySelector('[data-company-mode]').addEventListener('click',()=>{companyAuthMode='register';renderCompanyPanel()});
  panel.querySelector('#company-login-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const button=form.querySelector('.auth-submit');const email=form.elements.email.value.trim().toLowerCase();
    if(email.includes('@')&&!validCompanyEmail(email)){setCompanyMessage('company-login-message','Enter a valid company email address.','error');return}
    button.disabled=true;button.classList.add('busy');
    try{await companyRequest('login',{body:{email,password:form.elements.password.value}});await showCompanyWorkspace()}
    catch(error){setCompanyMessage('company-login-message',error.message,'error')}
    finally{button.disabled=false;button.classList.remove('busy')}
  });
}
function renderCompanyRegistration(panel){
  panel.innerHTML=`<form class="auth-form company-register-form" id="company-register-form" novalidate>
    <div class="auth-field-grid"><label class="auth-field"><span>Company name</span><input name="companyName" autocomplete="organization" maxlength="120" placeholder="Official company name" required /></label><label class="auth-field"><span>Industry</span><input name="industry" maxlength="100" placeholder="Technology, finance..." required /></label></div>
    <label class="auth-field"><span>Company official email</span><input name="email" type="email" autocomplete="email" placeholder="name@company.com" required /><small>Use an address your organization uses for work.</small></label>
    <div class="auth-field-grid"><label class="auth-field"><span>Contact person</span><input name="contactName" autocomplete="name" maxlength="100" placeholder="Your full name" required /></label><label class="auth-field"><span>Work title</span><input name="jobTitle" autocomplete="organization-title" maxlength="100" placeholder="Recruiter, HR lead..." required /></label></div>
    <label class="auth-field"><span>Company website <small>(optional)</small></span><input name="website" type="url" autocomplete="url" placeholder="https://company.com" /></label>
    <label class="auth-field"><span>Work and hiring details</span><textarea name="workDetails" rows="3" maxlength="2000" placeholder="Tell colleges what your company does, the roles you hire for, and any useful location or eligibility details." required></textarea><small>These details help placement teams understand your hiring needs.</small></label>
    <div class="auth-field-grid"><label class="auth-field"><span>Create password</span><input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="At least 8 characters" required /></label><label class="auth-field"><span>Confirm password</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="Repeat password" required /></label></div>
    <div class="auth-message" id="company-register-message" role="status"></div>
    <button class="auth-submit" type="submit"><span>Create company account</span><b aria-hidden="true">&rarr;</b></button>
  </form>`;
  panel.querySelector('#company-register-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const email=form.elements.email.value.trim().toLowerCase();const password=form.elements.password.value;const workDetails=form.elements.workDetails.value.trim();
    if(!validCompanyEmail(email)){setCompanyMessage('company-register-message','Enter a valid official company email address.','error');return}
    if(password.length<8){setCompanyMessage('company-register-message','Use a password with at least 8 characters.','error');return}
    if(password!==form.elements.confirmPassword.value){setCompanyMessage('company-register-message','The passwords do not match.','error');return}
    if(workDetails.length<10){setCompanyMessage('company-register-message','Add a few details about your work and hiring needs.','error');return}
    const button=form.querySelector('.auth-submit');button.disabled=true;button.classList.add('busy');
    try{
      await companyRequest('register',{body:{email,companyName:form.elements.companyName.value.trim(),industry:form.elements.industry.value.trim(),contactName:form.elements.contactName.value.trim(),jobTitle:form.elements.jobTitle.value.trim(),website:form.elements.website.value.trim(),workDetails,password}});
      await showCompanyWorkspace();
    }catch(error){setCompanyMessage('company-register-message',error.message,'error');button.disabled=false}
    finally{button.classList.remove('busy')}
  });
}
function setCompanyMessage(id,message,type='info'){const node=document.getElementById(id);if(node){node.textContent=message;node.dataset.type=type}}
async function showCompanyWorkspace(){
  const panel=document.getElementById('company-auth-panel');if(!panel)return;
  try{
    const result=await companyRequest('me',{method:'GET'});const company=result.company;
    panel.innerHTML=`<div class="company-profile"><div class="company-profile-mark" aria-hidden="true">A</div><span class="auth-eyebrow">COMPANY PROFILE</span><h3 class="company-profile-name"></h3><div class="company-profile-grid"><div><small>INDUSTRY</small><strong class="company-profile-industry"></strong></div><div><small>CONTACT</small><strong class="company-profile-contact"></strong></div></div><div class="company-profile-details"><small>WORK &amp; HIRING DETAILS</small><p class="company-profile-work"></p></div><button class="auth-submit" type="button" data-company-close><span>Done</span><b aria-hidden="true">&rarr;</b></button></div>`;
    panel.querySelector('.company-profile-name').textContent=company.companyName;
    panel.querySelector('.company-profile-industry').textContent=company.industry;
    panel.querySelector('.company-profile-contact').textContent=`${company.contactName} · ${company.jobTitle}`;
    panel.querySelector('.company-profile-work').textContent=company.workDetails;
    panel.querySelector('[data-company-close]').addEventListener('click',closeCompanyWindow);
  }catch(error){panel.innerHTML='<div class="auth-message" id="company-workspace-error" role="status"></div>';setCompanyMessage('company-workspace-error',error.message,'error')}
}
function closeCompanyWindow(){const stage=companyAuthRoot.querySelector('.company-stage');if(!stage)return;stage.classList.add('closing');setTimeout(()=>{companyAuthRoot.replaceChildren();companyAuthMode='login'},180)}
document.addEventListener('company-portal:open',openCompanyPortal);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&companyAuthRoot.querySelector('.company-stage'))closeCompanyWindow()});
