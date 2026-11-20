const collegeAuthRoot=document.getElementById('college-auth-root');
let collegeAuthMode='login';
let collegeVerifiedEmail='';
let collegeUsernameTimer;
let activeCollegeView='placements';
let collegeWorkspaceData=null;
function validOfficialEmail(value){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value||'').trim())}
function setCollegeMessage(id,message,type='info'){const node=document.getElementById(id);if(node){node.textContent=message;node.dataset.type=type}}
async function collegeRequest(path,{method='POST',body}={}){
  if(location.protocol==='file:')throw new Error('Open Akterra through the local server to use this portal.');
  let response;
  try{response=await fetch(`/api/college/${path}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'})}
  catch{throw new Error('Cannot reach the Akterra server. Double-click start-akterra.bat in the project folder and keep its server window open.')}
  let result={};try{result=await response.json()}catch{}
  if(!response.ok)throw new Error(result.error||'Something went wrong. Please try again.');
  return result;
}
function openCollegePortal(){
  collegeAuthMode='login';renderCollegeWindow(true);
  collegeRequest('me',{method:'GET'}).then(()=>loadCollegeWorkspace()).catch(()=>renderCollegePanel());
}
function renderCollegeWindow(checkingSession=false){
  collegeAuthRoot.innerHTML=`<div class="auth-stage college-stage" id="college-stage">
    <button class="auth-dismiss-layer" type="button" aria-label="Close college admin portal" data-college-close></button>
    <div class="blood-flow" aria-hidden="true"><i class="blood-rush rush-top"></i><i class="blood-rush rush-right"></i><i class="blood-rush rush-bottom"></i><i class="blood-rush rush-left"></i></div>
    <section class="auth-window college-window" role="dialog" aria-modal="true" aria-labelledby="college-auth-title">
      <header class="auth-header"><div><div class="auth-eyebrow">AKTERRA &middot; COLLEGE ACCESS</div><h2 id="college-auth-title">College Admin portal</h2><p>Manage your college workspace and registered email domains.</p></div><button class="auth-close" type="button" aria-label="Close" data-college-close>&times;</button></header>
      <div class="auth-tabs" role="tablist" aria-label="College admin account options"><button class="auth-tab" type="button" role="tab" data-college-mode="login">Log in</button><button class="auth-tab" type="button" role="tab" data-college-mode="register">Register college</button></div>
      <div class="auth-panel" id="college-auth-panel"></div>
      <div class="auth-footnote"><span class="auth-lock" aria-hidden="true">&#9670;</span> College domains are added to the registry after an official email is verified.</div>
    </section>
  </div>`;
  collegeAuthRoot.querySelectorAll('[data-college-close]').forEach(button=>button.addEventListener('click',closeCollegeWindow));
  collegeAuthRoot.querySelectorAll('[data-college-mode]').forEach(button=>button.addEventListener('click',()=>{collegeAuthMode=button.dataset.collegeMode;renderCollegePanel()}));
  if(checkingSession){setCollegeAuthOptionsVisible(false);document.getElementById('college-auth-panel').innerHTML='<div class="college-loading">Checking your college session...</div>'}
  else renderCollegePanel();
  if(!checkingSession)collegeAuthRoot.querySelector('[data-college-mode="login"]').focus({preventScroll:true});
}
function renderCollegePanel(){
  const panel=document.getElementById('college-auth-panel');if(!panel)return;
  setCollegeAuthOptionsVisible(true);
  collegeAuthRoot.querySelectorAll('[data-college-mode]').forEach(button=>{const active=button.dataset.collegeMode===collegeAuthMode;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active))});
  if(collegeAuthMode==='login')renderCollegeLogin(panel);else renderCollegeRegistration(panel);
}
function setCollegeAuthOptionsVisible(visible){
  const stage=collegeAuthRoot.querySelector('.college-stage');if(!stage)return;
  const tabs=stage.querySelector('.auth-tabs');const footnote=stage.querySelector('.auth-footnote');
  if(tabs)tabs.hidden=!visible;
  if(footnote)footnote.hidden=!visible;
}
function renderCollegeLogin(panel){
  panel.innerHTML=`<form class="auth-form" id="college-login-form" novalidate>
    <label class="auth-field"><span>College admin username</span><input name="username" autocomplete="username" minlength="3" maxlength="32" placeholder="Your unique username" required /></label>
    <label class="auth-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Your password" required /></label>
    <small class="demo-access-hint">The project admin demo login also works in this portal.</small>
    <div class="auth-message" id="college-login-message" role="status"></div>
    <button class="auth-submit" type="submit"><span>Enter college workspace</span><b aria-hidden="true">&rarr;</b></button>
    <p class="auth-switch">New college? <button type="button" data-college-mode="register">Register your college</button></p>
  </form>`;
  panel.querySelector('[data-college-mode]').addEventListener('click',()=>{collegeAuthMode='register';renderCollegePanel()});
  panel.querySelector('#college-login-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;const button=form.querySelector('.auth-submit');button.disabled=true;button.classList.add('busy');
    try{await collegeRequest('login',{body:{username:form.elements.username.value.trim(),password:form.elements.password.value}});await loadCollegeWorkspace()}
    catch(error){setCollegeMessage('college-login-message',error.message,'error')}
    finally{button.disabled=false;button.classList.remove('busy')}
  });
}
function renderCollegeRegistration(panel){
  collegeVerifiedEmail='';
  panel.innerHTML=`<form class="auth-form" id="college-register-form" novalidate>
    <label class="auth-field"><span>College name</span><input name="collegeName" autocomplete="organization" minlength="3" maxlength="120" placeholder="Official college name" required /></label>
    <label class="auth-field"><span>Director or placement lead email</span><input name="email" type="email" autocomplete="email" placeholder="name@college.edu" required /><small>The email domain will be attached to your college after verification.</small></label>
    <div class="otp-row"><button class="auth-secondary" id="college-send-otp" type="button">Send Gmail OTP</button><span class="auth-message" id="college-otp-message" role="status">Verify the official college email to continue.</span></div>
    <div class="otp-check" id="college-otp-check" hidden><label class="auth-field"><span>Email verification code</span><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" /></label><button class="auth-secondary" id="college-verify-otp" type="button">Verify code</button></div>
    <label class="auth-field"><span>Unique admin username</span><input name="username" autocomplete="username" minlength="3" maxlength="32" placeholder="Suggested from your email" required /><small id="college-username-hint">Suggested from the part before @. It must be unique.</small></label>
    <div class="auth-field-grid"><label class="auth-field"><span>Create password</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required /></label><label class="auth-field"><span>Confirm password</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Repeat password" required /></label></div>
    <div class="auth-message" id="college-register-message" role="status"></div>
    <button class="auth-submit" id="college-create" type="submit" disabled><span>Create college workspace</span><b aria-hidden="true">&rarr;</b></button>
  </form>`;
  const form=panel.querySelector('#college-register-form');const emailInput=form.elements.email;const usernameInput=form.elements.username;const otpInput=form.elements.otp;const otpCheck=panel.querySelector('#college-otp-check');const sendButton=panel.querySelector('#college-send-otp');const createButton=panel.querySelector('#college-create');let otpSentEmail='';let suggest=true;
  emailInput.addEventListener('input',()=>{
    const email=emailInput.value.trim().toLowerCase();
    if(collegeVerifiedEmail&&email!==collegeVerifiedEmail){collegeVerifiedEmail='';createButton.disabled=true;setCollegeMessage('college-otp-message','Email changed. Verify the new address before registering.','error')}
    if(otpSentEmail&&email!==otpSentEmail){otpSentEmail='';otpCheck.hidden=true}
    if(suggest){const prefix=email.split('@')[0].replace(/[^a-z0-9._-]/g,'').slice(0,24);usernameInput.value=prefix;checkUsername(prefix)}
    if(!validOfficialEmail(email)){sendButton.disabled=true;if(!email.includes('@'))setCollegeMessage('college-otp-message','Enter the official college email first.');return}
    sendButton.disabled=false;
    if(!collegeVerifiedEmail)setCollegeMessage('college-otp-message','Gmail OTP will verify this email and domain.');
  });
  usernameInput.addEventListener('input',()=>{suggest=false;checkUsername(usernameInput.value.trim())});
  function checkUsername(username){
    clearTimeout(collegeUsernameTimer);const hint=document.getElementById('college-username-hint');
    if(!username){hint.textContent='Enter a unique username.';hint.dataset.type='error';return}
    hint.textContent='Checking username availability...';hint.dataset.type='info';
    collegeUsernameTimer=setTimeout(async()=>{try{const result=await collegeRequest(`username-available?username=${encodeURIComponent(username)}`,{method:'GET'});if(usernameInput.value.trim()!==username)return;hint.textContent=result.available?'Username is available.':(result.reason||'That username is taken. Choose another.');hint.dataset.type=result.available?'success':'error'}catch(error){if(usernameInput.value.trim()===username){hint.textContent=error.message;hint.dataset.type='error'}}},350);
  }
  sendButton.addEventListener('click',async()=>{
    const email=emailInput.value.trim().toLowerCase();if(!validOfficialEmail(email)){setCollegeMessage('college-otp-message','Enter a valid official college email.','error');return}
    sendButton.disabled=true;sendButton.textContent='Sending...';
    try{await collegeRequest('send-otp',{body:{email}});otpSentEmail=email;otpCheck.hidden=false;setCollegeMessage('college-otp-message',`A code was sent to ${email}. It expires in 5 minutes.`,'success');otpInput.focus()}
    catch(error){setCollegeMessage('college-otp-message',error.message,'error')}
    finally{sendButton.disabled=false;sendButton.textContent='Resend Gmail OTP'}
  });
  panel.querySelector('#college-verify-otp').addEventListener('click',async event=>{
    const button=event.currentTarget;const email=emailInput.value.trim().toLowerCase();const code=otpInput.value.trim();
    if(email!==otpSentEmail){setCollegeMessage('college-otp-message','Send a new code to this email address first.','error');return}
    button.disabled=true;button.textContent='Checking...';
    try{await collegeRequest('verify-otp',{body:{email,code}});collegeVerifiedEmail=email;createButton.disabled=false;setCollegeMessage('college-otp-message','Official email verified. You can create the college workspace.','success')}
    catch(error){setCollegeMessage('college-otp-message',error.message,'error')}
    finally{button.disabled=false;button.textContent='Verify code'}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();const email=emailInput.value.trim().toLowerCase();const password=form.elements.password.value;const confirmPassword=form.elements.confirmPassword.value;
    if(!validOfficialEmail(email)){setCollegeMessage('college-register-message','Enter a valid official college email.','error');return}
    if(collegeVerifiedEmail!==email){setCollegeMessage('college-register-message','Verify your official email with Gmail OTP first.','error');return}
    if(password.length<8){setCollegeMessage('college-register-message','Use a password with at least 8 characters.','error');return}
    if(password!==confirmPassword){setCollegeMessage('college-register-message','The passwords do not match.','error');return}
    const button=panel.querySelector('#college-create');button.disabled=true;button.classList.add('busy');
    try{await collegeRequest('register',{body:{collegeName:form.elements.collegeName.value.trim(),email,username:usernameInput.value.trim(),password,code:otpInput.value.trim()}});await loadCollegeWorkspace()}
    catch(error){setCollegeMessage('college-register-message',error.message,'error');button.disabled=false}
    finally{button.classList.remove('busy')}
  });
}
function setupDomainForm(panel){
  const form=panel.querySelector('#add-domain-form');const email=form.elements.email;const code=form.elements.code;const otpCheck=panel.querySelector('#domain-otp-check');const send=panel.querySelector('#domain-send-otp');let sentEmail='';
  send.addEventListener('click',async()=>{
    const value=email.value.trim().toLowerCase();if(!validOfficialEmail(value)){setCollegeMessage('domain-message','Enter a valid email at the domain you want to add.','error');return}
    send.disabled=true;send.textContent='Sending...';
    try{await collegeRequest('domain/send-otp',{body:{email:value}});sentEmail=value;otpCheck.hidden=false;setCollegeMessage('domain-message',`A code was sent to ${value}.`,'success');code.focus()}
    catch(error){setCollegeMessage('domain-message',error.message,'error')}
    finally{send.disabled=false;send.textContent='Resend domain OTP'}
  });
  email.addEventListener('input',()=>{if(sentEmail&&email.value.trim().toLowerCase()!==sentEmail){sentEmail='';otpCheck.hidden=true;setCollegeMessage('domain-message','Email changed. Request a new code for this address.','error')}});
  form.addEventListener('submit',async event=>{
    event.preventDefault();const value=email.value.trim().toLowerCase();if(value!==sentEmail){setCollegeMessage('domain-message','Send a code to this email address first.','error');return}
    const button=form.querySelector('[type="submit"]');button.disabled=true;button.classList.add('busy');
    try{await collegeRequest('domain/add',{body:{email:value,code:code.value.trim()}});await loadCollegeWorkspace('domains')}
    catch(error){setCollegeMessage('domain-message',error.message,'error');button.disabled=false}
    finally{button.classList.remove('busy')}
  });
}
function collegeEscape(value=''){
  return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function lpaLabel(value){return value===null||value===undefined?'—':`₹${Number(value).toFixed(2)} LPA`}
async function loadCollegeWorkspace(startingView='placements'){
  if(!collegeAuthRoot)return;
  try{
    collegeWorkspaceData=await collegeRequest('me',{method:'GET'});
    window.dispatchEvent(new Event('akterra:leaderboard-updated'));
    activeCollegeView=startingView;
    collegeAuthRoot.innerHTML=`<main class="college-dashboard-stage" id="college-dashboard-stage"><header class="college-dashboard-header"><a class="college-dashboard-brand" href="#" data-college-home><span class="college-dashboard-mark"><img src="assets/akterra-logo.jpeg" alt="" /></span><span><strong>AKTERRA</strong><small>PLACEMENT UNIVERSE</small></span></a><div class="college-dashboard-title"><span class="auth-eyebrow">COLLEGE ADMIN WORKSPACE</span><h1 class="college-name"></h1><p class="college-admin-name"></p></div><div class="college-dashboard-actions"><button class="auth-secondary" id="college-home" type="button">Main site</button><button class="auth-secondary" id="college-logout" type="button">Log out</button></div></header><nav class="college-workspace-tabs" aria-label="College workspace sections"><button type="button" data-college-view="students">Students</button><button type="button" data-college-view="placements">Placements</button><button type="button" data-college-view="leaderboard">Leaderboard</button><button type="button" data-college-view="method">How it ranks</button><button type="button" data-college-view="domains">Domains</button></nav><section class="college-dashboard-content"><div class="college-view-host" id="college-view-host"></div></section></main>`;
    collegeAuthRoot.querySelector('.college-name').textContent=collegeWorkspaceData.college.name;
    collegeAuthRoot.querySelector('.college-admin-name').textContent=`Signed in as ${collegeWorkspaceData.admin.username}`;
    collegeAuthRoot.querySelector('#college-home').addEventListener('click',closeCollegeWindow);
    collegeAuthRoot.querySelector('[data-college-home]').addEventListener('click',event=>{event.preventDefault();closeCollegeWindow()});
    collegeAuthRoot.querySelector('#college-logout').addEventListener('click',async()=>{try{await collegeRequest('logout')}catch{}collegeAuthMode='login';collegeAuthRoot.replaceChildren()});
    collegeAuthRoot.querySelectorAll('[data-college-view]').forEach(button=>button.addEventListener('click',()=>{activeCollegeView=button.dataset.collegeView;renderCollegeView()}));
    await renderCollegeView();
  }catch(error){
    const panel=document.getElementById('college-auth-panel');
    if(panel){setCollegeAuthOptionsVisible(true);panel.innerHTML='<div class="auth-message" id="workspace-error" role="status"></div>';setCollegeMessage('workspace-error',error.message,'error')}
    else{collegeAuthRoot.innerHTML=`<main class="college-dashboard-stage"><div class="college-dashboard-error"><div class="auth-message" id="workspace-error" role="status"></div><button class="auth-secondary" type="button" id="dashboard-error-home">Return to main site</button></div></main>`;setCollegeMessage('workspace-error',error.message,'error');collegeAuthRoot.querySelector('#dashboard-error-home').addEventListener('click',closeCollegeWindow)}
  }
}
async function renderCollegeView(){
  const host=document.getElementById('college-view-host');if(!host)return;
  collegeAuthRoot.querySelectorAll('[data-college-view]').forEach(button=>button.classList.toggle('active',button.dataset.collegeView===activeCollegeView));
  if(activeCollegeView==='students')return renderCollegeStudents(host);
  if(activeCollegeView==='placements')return renderCollegePlacements(host);
  if(activeCollegeView==='leaderboard')return renderCollegeLeaderboard(host);
  if(activeCollegeView==='method')return renderCollegeMethod(host);
  if(activeCollegeView==='domains')return renderCollegeDomains(host);
}
function collegeDateLabel(value){const date=new Date(value);return Number.isNaN(date.valueOf())?'—':date.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})}
async function renderCollegeStudents(host){
  host.innerHTML='<div class="college-loading">Loading students from your college email domains...</div>';
  try{
    const result=await collegeRequest('students',{method:'GET'});
    host.innerHTML=`<div class="leaderboard-intro"><span class="auth-eyebrow">REGISTERED STUDENTS</span><p>Students are matched to this college through their verified college email domain.</p></div><div class="privacy-note">This college-only list shows each student&rsquo;s registered college email ID, account username, and join date. Student contact details beyond that email and placement package values are not displayed.</div><div class="placement-records-head"><div><span class="auth-eyebrow">${result.students.length} STUDENT${result.students.length===1?'':'S'}</span><small>Accounts registered under your verified college domains</small></div></div><div class="placement-table-wrap"><table class="placement-table"><thead><tr><th>College email ID</th><th>Account username</th><th>Joined</th></tr></thead><tbody>${result.students.map(student=>`<tr><td>${collegeEscape(student.collegeEmailId)}</td><td>${collegeEscape(student.username)}</td><td>${collegeEscape(collegeDateLabel(student.joinedAt))}</td></tr>`).join('')||'<tr><td colspan="3" class="placement-empty">No registered students found for this college yet.</td></tr>'}</tbody></table></div>`;
  }catch(error){host.innerHTML='<div class="auth-message" id="students-load-error" role="status"></div>';setCollegeMessage('students-load-error',error.message,'error')}
}
async function renderCollegePlacements(host){
  host.innerHTML='<div class="college-loading">Loading placement records...</div>';
  try{
    const [result,cohortResult]=await Promise.all([collegeRequest('placements',{method:'GET'}),collegeRequest('cohorts',{method:'GET'})]);
    const summary=result.summary;const records=result.records;const cohorts=cohortResult.cohorts;
    const averageLabel=summary.packageAverageSuppressed?'Private until 5 placements':lpaLabel(summary.averagePackageLpa);
    host.innerHTML=`<div class="placement-summary"><div><small>SUCCESSFUL PLACEMENTS</small><strong>${summary.placementCount}</strong></div><div><small>AVERAGE PACKAGE</small><strong>${averageLabel}</strong></div></div>
      <div class="privacy-note">The leaderboard uses only classes with a reported graduating class size. Add each class&rsquo;s total eligible graduates below; the class size stays in your college workspace. Public ratings show aggregate placement rates, and package averages stay hidden until at least five placements in rated years.</div>
      <section class="cohort-size-panel"><div class="placement-records-head"><div><span class="auth-eyebrow">GRADUATING CLASS SIZES</span><small>Required to calculate fair placement rates</small></div></div><p>Enter the total number of students eligible to graduate for each year. No student names or IDs are needed.</p><form id="cohort-size-form" class="cohort-size-form"><label class="auth-field"><span>Graduation year</span><input name="graduationYear" type="number" min="2000" max="2100" step="1" placeholder="2026" required /></label><label class="auth-field"><span>Eligible graduating students</span><input name="eligibleStudentCount" type="number" min="1" max="100000" step="1" placeholder="e.g. 200" required /></label><button class="auth-secondary" type="submit">Save class size</button><div class="auth-message" id="cohort-size-message" role="status"></div></form><div class="placement-table-wrap"><table class="placement-table"><thead><tr><th>Graduation year</th><th>Eligible students</th><th>Recorded placements</th></tr></thead><tbody>${cohorts.map(cohort=>`<tr><td>${cohort.graduationYear}</td><td>${cohort.eligibleStudentCount}</td><td>${cohort.placedCount}</td></tr>`).join('')||'<tr><td colspan="3" class="placement-empty">No class sizes reported yet.</td></tr>'}</tbody></table></div></section>
      <details class="placement-add"><summary>+ Record a successful placement</summary><form id="placement-form" class="auth-form"><div class="auth-field-grid"><label class="auth-field"><span>Public name or initials <small>(optional)</small></span><input name="studentPublicName" maxlength="100" placeholder="Leave blank to keep anonymous" /><small>Only include a name if it is approved for public use. Do not enter contact details or student IDs.</small></label><label class="auth-field"><span>Programme or department</span><input name="programme" maxlength="120" placeholder="Computer Science" required /></label></div><div class="auth-field-grid"><label class="auth-field"><span>Graduation year</span><input name="graduationYear" type="number" min="2000" max="2100" step="1" placeholder="2026" required /></label><label class="auth-field"><span>Hiring company</span><input name="companyName" maxlength="120" placeholder="Company name" required /></label></div><div class="auth-field-grid"><label class="auth-field"><span>Selected role</span><input name="role" maxlength="120" placeholder="Software Engineer" required /></label><label class="auth-field"><span>Package (LPA)</span><input name="packageLpa" type="number" min="0.01" max="1000" step="0.01" placeholder="e.g. 8.50" required /><small>Included in the public package rating only for rated years; hidden until 5 such placements.</small></label></div><label class="placement-attestation"><input name="placementAttestation" type="checkbox" required /><span>One record per placed student, even if they received multiple offers. I confirm these fields contain no private contact details, student IDs, or other sensitive information.</span></label><div class="auth-message" id="placement-message" role="status"></div><button class="auth-submit" type="submit"><span>Save placement</span><b aria-hidden="true">&rarr;</b></button></form></details>
      <div class="placement-records-head"><div><span class="auth-eyebrow">YOUR COLLEGE RECORDS</span><small>Non-contact placement details, visible only to your college admins</small></div></div><div class="placement-table-wrap"><table class="placement-table"><thead><tr><th>Public label</th><th>Programme / year</th><th>Company / role</th><th></th></tr></thead><tbody>${records.map(record=>`<tr><td>${collegeEscape(record.studentPublicName||'Anonymous')}</td><td>${collegeEscape(record.programme)}<small>Class of ${collegeEscape(record.graduationYear)}</small></td><td>${collegeEscape(record.companyName)}<small>${collegeEscape(record.role)}</small></td><td><button class="delete-placement" type="button" data-delete-placement="${collegeEscape(record.id)}" aria-label="Remove placement record">&times;</button></td></tr>`).join('')||'<tr><td colspan="4" class="placement-empty">No placement records yet. Add the first successful placement above.</td></tr>'}</tbody></table></div>`;
    host.querySelector('#cohort-size-form').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget;const button=form.querySelector('[type="submit"]');button.disabled=true;
      try{await collegeRequest('cohorts',{body:{graduationYear:form.elements.graduationYear.value,eligibleStudentCount:form.elements.eligibleStudentCount.value}});window.dispatchEvent(new Event('akterra:leaderboard-updated'));await renderCollegePlacements(host)}
      catch(error){setCollegeMessage('cohort-size-message',error.message,'error');button.disabled=false}
    });
    host.querySelector('#placement-form').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget;const button=form.querySelector('.auth-submit');button.disabled=true;button.classList.add('busy');
      const body={studentPublicName:form.elements.studentPublicName.value.trim(),programme:form.elements.programme.value.trim(),graduationYear:form.elements.graduationYear.value,companyName:form.elements.companyName.value.trim(),role:form.elements.role.value.trim(),packageLpa:form.elements.packageLpa.value,publicDataApproved:form.elements.placementAttestation.checked};
      try{await collegeRequest('placements',{body});window.dispatchEvent(new Event('akterra:leaderboard-updated'));await renderCollegePlacements(host)}
      catch(error){setCollegeMessage('placement-message',error.message,'error');button.disabled=false}
      finally{button.classList.remove('busy')}
    });
    host.querySelectorAll('[data-delete-placement]').forEach(button=>button.addEventListener('click',async()=>{
      if(!window.confirm('Remove this placement record? Its package will no longer count toward your average or the leaderboard.'))return;
      button.disabled=true;
      try{await collegeRequest(`placements/${encodeURIComponent(button.dataset.deletePlacement)}`,{method:'DELETE'});window.dispatchEvent(new Event('akterra:leaderboard-updated'));await renderCollegePlacements(host)}
      catch(error){button.disabled=false;window.alert(error.message)}
    }));
  }catch(error){host.innerHTML='<div class="auth-message" id="placements-load-error" role="status"></div>';setCollegeMessage('placements-load-error',error.message,'error')}
}
async function renderCollegeLeaderboard(host){
  host.innerHTML='<div class="college-loading">Calculating aggregate rankings...</div>';
  try{
    const response=await fetch('/api/leaderboard',{credentials:'same-origin'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not load the leaderboard.');
    host.innerHTML=`<div class="leaderboard-intro"><span class="auth-eyebrow">AKTERRA COLLEGE LEADERBOARD</span><p>Counts and rates below use only graduating years with a reported class size. Package data stays private until at least five placements in rated years. An asterisk marks a provisional rating based on placement rate only.</p></div><div class="leaderboard-table-wrap"><table class="placement-table leaderboard-table"><thead><tr><th>Rank</th><th>College</th><th>Placements in rated years</th><th>Placement rate</th><th>Average package</th><th>Rating / 100</th></tr></thead><tbody>${result.rows.map(row=>`<tr><td><span class="leader-rank">${row.rank??'—'}</span></td><td>${collegeEscape(row.collegeName)}</td><td>${row.placementCount}</td><td>${row.placementRatePercent===null?'Class size needed':`${row.placementRatePercent.toFixed(1)}%`}</td><td>${row.packageAverageSuppressed?(row.placementCount?'Private until 5 rated placements':'—'):lpaLabel(row.averagePackageLpa)}</td><td><span class="leader-score">${row.score===null?'—':`${row.score.toFixed(1)}${row.scoreStatus==='provisional'?'*':''}`}</span></td></tr>`).join('')||'<tr><td colspan="6" class="placement-empty">No colleges are registered yet.</td></tr>'}</tbody></table></div><button class="text-action college-method-link" type="button" data-open-method>See how the score is calculated &rarr;</button>`;
    host.querySelector('[data-open-method]')?.addEventListener('click',()=>{activeCollegeView='method';renderCollegeView()});
  }catch(error){host.innerHTML='<div class="auth-message" id="leaderboard-error" role="status"></div>';setCollegeMessage('leaderboard-error',error.message,'error')}
}
function renderCollegeMethod(host){
  host.innerHTML=`<div class="method-intro"><span class="auth-eyebrow">TRANSPARENT SCORING</span><h4>How the leaderboard is calculated</h4><p>Each college reports the size of each graduating class. The rating uses placements and class sizes only for years with a saved class size.</p></div><div class="score-formula"><article><span>01 &middot; PLACEMENT RATE</span><strong>75% of the final rating</strong><code>placements &divide; eligible graduates &times; 100</code><p>Combines reported graduating years as total placements divided by total eligible graduates. College class sizes are private.</p></article><article><span>02 &middot; PACKAGE ATTAINMENT</span><strong>25% of the final rating</strong><code>min(average package &divide; ₹20 LPA, 1) &times; 100</code><p>Uses the average package from rated years and a fixed ₹20 LPA benchmark, capped at 100%. The average stays hidden until there are at least five placements in rated years.</p></article></div><div class="score-total"><strong>Final rating = 0.75 &times; placement rate + 0.25 &times; package attainment</strong><span>Example: 120 placements out of 200 eligible graduates = 60% placement rate. An ₹8 LPA average reaches 40% of the package benchmark. Rating = (0.75 &times; 60) + (0.25 &times; 40) = 55 / 100.</span><span>Before five placements in rated years, the package average and its contribution stay private; the displayed rating is provisional and equals the placement rate alone. Colleges need a reported class size to receive a rating, and colleges with no placements in rated years are not ranked.</span><span>Ties are broken by placement rate, rated placement count, average package, then college name.</span></div><div class="privacy-note"><b>Privacy by design.</b> Public results contain college names, placements in rated years, placement rates, and package averages only after the five-placement threshold. They never include student names, college email IDs, class sizes, contact details, company-role rows, or individual package values. Your workspace shows this college&rsquo;s class sizes and non-contact placement records. Package values are not returned with those records.</div>`;
}
function renderCollegeDomains(host){
  const college=collegeWorkspaceData?.college;const domains=college?.domains||[];
  host.innerHTML=`<div class="domain-list-label">REGISTERED EMAIL DOMAINS</div><div class="domain-list">${domains.map(domain=>'<span class="domain-chip"></span>').join('')||'<span class="domain-empty">No domains added yet.</span>'}</div><form class="auth-form domain-form" id="add-domain-form"><label class="auth-field"><span>Add another college email domain</span><input name="email" type="email" placeholder="director@another-campus.edu" required /><small>Enter an email at the domain you want to add. We will send an OTP to confirm it.</small></label><div class="otp-row"><button class="auth-secondary" id="domain-send-otp" type="button">Send domain OTP</button><span class="auth-message" id="domain-message" role="status">Domain changes require email verification.</span></div><div class="otp-check" id="domain-otp-check" hidden><label class="auth-field"><span>Email verification code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" /></label><button class="auth-submit" type="submit"><span>Add verified domain</span><b aria-hidden="true">&rarr;</b></button></div></form>`;
  host.querySelectorAll('.domain-chip').forEach((chip,index)=>chip.textContent=domains[index]);
  setupDomainForm(host);
}
function closeCollegeWindow(){const stage=collegeAuthRoot.querySelector('.college-stage,.college-dashboard-stage');if(!stage)return;stage.classList.add('closing');setTimeout(()=>{collegeAuthRoot.replaceChildren();collegeVerifiedEmail='';collegeAuthMode='login'},180)}
document.addEventListener('college-portal:open',openCollegePortal);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&collegeAuthRoot.querySelector('.college-stage,.college-dashboard-stage'))closeCollegeWindow()});
