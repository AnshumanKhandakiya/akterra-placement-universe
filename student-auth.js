const authRoot=document.getElementById('student-auth-root');
let authMode='login';
let verifiedEmail='';
let usernameTimer;

function validCollegeEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email.trim())}
function showAuthMessage(id,message,type='info'){
  const element=document.getElementById(id);
  if(element){element.textContent=message;element.dataset.type=type}
}
async function authRequest(path,{method='POST',body}={}){
  if(location.protocol==='file:')throw new Error('Open the app through the local server to use student login and Gmail verification.');
  let response;
  try{
    response=await fetch(`/api/student/${path}`,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,credentials:'same-origin'});
  }catch{
    throw new Error('Cannot reach the Akterra server. Double-click start-akterra.bat in the project folder and keep its server window open.');
  }
  let result={};
  try{result=await response.json()}catch{}
  if(!response.ok)throw new Error(result.error||'Something went wrong. Please try again.');
  return result;
}

function renderStudentAuth(){
  authRoot.innerHTML=`<div class="auth-stage" id="auth-stage">
    <button class="auth-dismiss-layer" type="button" aria-label="Close student sign in" data-auth-close></button>
    <div class="blood-flow" aria-hidden="true"><i class="blood-rush rush-top"></i><i class="blood-rush rush-right"></i><i class="blood-rush rush-bottom"></i><i class="blood-rush rush-left"></i></div>
    <section class="auth-window" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <header class="auth-header"><div><div class="auth-eyebrow">AKTERRA &middot; STUDENT ACCESS</div><h2 id="auth-title">Student portal</h2><p>Sign in or create your verified student account.</p></div><button class="auth-close" type="button" aria-label="Close" data-auth-close>&times;</button></header>
      <div class="auth-tabs" role="tablist" aria-label="Student account options"><button class="auth-tab" type="button" role="tab" data-auth-mode="login">Log in</button><button class="auth-tab" type="button" role="tab" data-auth-mode="register">New registration</button></div>
      <div class="auth-panel" id="auth-panel"></div>
      <div class="auth-footnote"><span class="auth-lock" aria-hidden="true">&#9670;</span> Registration is available to students whose college is registered with Akterra.</div>
    </section>
  </div>`;
  authRoot.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>{authMode=button.dataset.authMode;renderAuthPanel()}));
  authRoot.querySelectorAll('[data-auth-close]').forEach(button=>button.addEventListener('click',closeStudentAuth));
  renderAuthPanel();
  authRoot.querySelector('[data-auth-mode="login"]').focus({preventScroll:true});
}

function renderAuthPanel(){
  const panel=document.getElementById('auth-panel');
  if(!panel)return;
  authRoot.querySelectorAll('[data-auth-mode]').forEach(button=>{
    const active=button.dataset.authMode===authMode;
    button.classList.toggle('active',active);
    button.setAttribute('aria-selected',String(active));
  });
  if(authMode==='login')renderLoginForm(panel);else renderRegistrationForm(panel);
}

function renderLoginForm(panel){
  panel.innerHTML=`<form id="student-login-form" class="auth-form" novalidate>
    <label class="auth-field"><span>Username</span><input name="username" autocomplete="username" minlength="3" maxlength="32" placeholder="Your unique username" required /></label>
    <label class="auth-field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Your password" required /></label>
    <small class="demo-access-hint">The project admin demo login also works in this portal.</small>
    <div class="auth-message" id="login-message" role="status"></div>
    <button class="auth-submit" type="submit"><span>Enter student portal</span><b aria-hidden="true">&rarr;</b></button>
    <p class="auth-switch">New to Akterra? <button type="button" data-auth-mode="register">Create a student account</button></p>
  </form>`;
  panel.querySelectorAll('[data-auth-mode]').forEach(button=>button.addEventListener('click',()=>{authMode='register';renderAuthPanel()}));
  panel.querySelector('#student-login-form').addEventListener('submit',submitStudentLogin);
}

function renderRegistrationForm(panel){
  verifiedEmail='';
  panel.innerHTML=`<form id="student-register-form" class="auth-form" novalidate>
    <label class="auth-field"><span>College email</span><input name="email" type="email" autocomplete="email" placeholder="you@yourcollege.edu" required /><small>Use your college email. The verification code will be sent to this address.</small></label>
    <div class="otp-row"><button class="auth-secondary" id="send-otp" type="button" disabled>Send Gmail OTP</button><span class="auth-message" id="otp-message" role="status">Enter your college email to check registration.</span></div>
    <div class="otp-check" id="otp-check" hidden><label class="auth-field"><span>Email verification code</span><input name="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6-digit code" /></label><button class="auth-secondary" id="verify-otp" type="button">Verify code</button></div>
    <label class="auth-field"><span>Unique username</span><input name="username" autocomplete="username" minlength="3" maxlength="32" placeholder="Suggested from your email" required /><small id="username-hint">We suggest the part before @; you can edit it. Usernames must be unique.</small></label>
    <div class="auth-field-grid"><label class="auth-field"><span>Create password</span><input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required /></label><label class="auth-field"><span>Confirm password</span><input name="confirmPassword" type="password" autocomplete="new-password" minlength="8" placeholder="Repeat password" required /></label></div>
    <div class="auth-message" id="register-message" role="status"></div>
    <button class="auth-submit" id="create-account" type="submit" disabled><span>Create student account</span><b aria-hidden="true">&rarr;</b></button>
  </form>`;
  const form=panel.querySelector('#student-register-form');
  const emailInput=form.elements.email;
  const usernameInput=form.elements.username;
  const otpInput=form.elements.otp;
  const otpCheck=panel.querySelector('#otp-check');
  const createButton=panel.querySelector('#create-account');
  const sendOtpButton=panel.querySelector('#send-otp');
  let suggestedByEmail=true;
  let otpSentEmail='';
  let domainCheckTimer;

  emailInput.addEventListener('input',()=>{
    const email=emailInput.value.trim().toLowerCase();
    if(verifiedEmail&&email!==verifiedEmail){verifiedEmail='';createButton.disabled=true;showAuthMessage('otp-message','Email changed. Verify the new address before registering.','error')}
    if(otpSentEmail&&email!==otpSentEmail){otpSentEmail='';otpCheck.hidden=true;createButton.disabled=true}
    if(suggestedByEmail){
      const prefix=email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g,'').slice(0,24);
      usernameInput.value=prefix;
      checkUsername(prefix);
    }
    clearTimeout(domainCheckTimer);
    sendOtpButton.disabled=true;
    if(!validCollegeEmail(email)){
      showAuthMessage('otp-message',email.includes('@')?'Enter a valid college email address.':'Enter your college email.','info');
      return;
    }
    showAuthMessage('otp-message','Checking whether your college is registered...');
    domainCheckTimer=setTimeout(async()=>{
      try{
        const status=await authRequest(`college-status?email=${encodeURIComponent(email)}`,{method:'GET'});
        if(emailInput.value.trim().toLowerCase()!==email)return;
        sendOtpButton.disabled=!status.registered;
        showAuthMessage('otp-message',status.registered?'Your college is registered. You can request a Gmail OTP.':'Your college is not registered yet.',status.registered?'success':'error');
      }catch(error){if(emailInput.value.trim().toLowerCase()===email)showAuthMessage('otp-message',error.message,'error')}
    },300);
  });
  usernameInput.addEventListener('input',()=>{suggestedByEmail=false;checkUsername(usernameInput.value.trim())});
  function checkUsername(username){
    clearTimeout(usernameTimer);
    const hint=document.getElementById('username-hint');
    if(!username){hint.textContent='Enter a unique username.';hint.dataset.type='error';return}
    hint.textContent='Checking username availability...';hint.dataset.type='info';
    usernameTimer=setTimeout(async()=>{
      try{
        const result=await authRequest(`username-available?username=${encodeURIComponent(username)}`,{method:'GET'});
        if(usernameInput.value.trim()!==username)return;
        hint.textContent=result.available?'Username is available.':(result.reason||'That username is taken. Choose another one.');
        hint.dataset.type=result.available?'success':'error';
      }catch(error){if(usernameInput.value.trim()===username){hint.textContent=error.message;hint.dataset.type='error'}}
    },350);
  }

  panel.querySelector('#send-otp').addEventListener('click',async event=>{
    const button=event.currentTarget;
    const email=emailInput.value.trim().toLowerCase();
    if(!validCollegeEmail(email)){showAuthMessage('otp-message','Enter a valid college email address.','error');return}
    button.disabled=true;button.textContent='Sending...';
    try{
      await authRequest('send-otp',{body:{email}});
      otpSentEmail=email;otpCheck.hidden=false;showAuthMessage('otp-message',`A code was sent to ${email}. It expires in 5 minutes.`,'success');otpInput.focus();
    }catch(error){showAuthMessage('otp-message',error.message,'error')}
    finally{button.disabled=false;button.textContent='Resend Gmail OTP'}
  });
  panel.querySelector('#verify-otp').addEventListener('click',async event=>{
    const button=event.currentTarget;
    const email=emailInput.value.trim().toLowerCase();
    const code=otpInput.value.trim();
    if(email!==otpSentEmail){showAuthMessage('otp-message','Send a new code to this email address first.','error');return}
    if(!/^\d{6}$/.test(code)){showAuthMessage('otp-message','Enter the 6-digit code from your email.','error');return}
    button.disabled=true;button.textContent='Checking...';
    try{
      await authRequest('verify-otp',{body:{email,code}});
      verifiedEmail=email;createButton.disabled=false;showAuthMessage('otp-message','Email verified. You can create your account.','success');
    }catch(error){showAuthMessage('otp-message',error.message,'error')}
    finally{button.disabled=false;button.textContent='Verify code'}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const email=emailInput.value.trim().toLowerCase();
    const username=usernameInput.value.trim();
    const password=form.elements.password.value;
    const confirmPassword=form.elements.confirmPassword.value;
    if(!validCollegeEmail(email)){showAuthMessage('register-message','Enter a valid college email address.','error');return}
    if(verifiedEmail!==email){showAuthMessage('register-message','Verify your college email with the Gmail OTP first.','error');return}
    if(password.length<8){showAuthMessage('register-message','Use a password with at least 8 characters.','error');return}
    if(password!==confirmPassword){showAuthMessage('register-message','The passwords do not match.','error');return}
    const submit=panel.querySelector('#create-account');submit.disabled=true;submit.classList.add('busy');
    try{
      const result=await authRequest('register',{body:{email,username,password,code:otpInput.value.trim()}});
      showAuthSuccess(result.username,'Your student account is ready.');
    }catch(error){showAuthMessage('register-message',error.message,'error');submit.disabled=false}
    finally{submit.classList.remove('busy')}
  });
}

async function submitStudentLogin(event){
  event.preventDefault();
  const form=event.currentTarget;
  const button=form.querySelector('.auth-submit');
  button.disabled=true;button.classList.add('busy');
  try{
    const result=await authRequest('login',{body:{username:form.elements.username.value.trim(),password:form.elements.password.value}});
    showAuthSuccess(result.username,'Signed in to the student portal.');
  }catch(error){showAuthMessage('login-message',error.message,'error')}
  finally{button.disabled=false;button.classList.remove('busy')}
}

function showAuthSuccess(username,message){
  const panel=document.getElementById('auth-panel');
  if(!panel)return;
  panel.innerHTML=`<div class="auth-success"><span class="success-seal" aria-hidden="true">&#10003;</span><h3>Access granted</h3><p class="auth-welcome"></p><p>${message}</p><button class="auth-submit" type="button" data-auth-close><span>Done</span><b aria-hidden="true">&rarr;</b></button></div>`;
  panel.querySelector('.auth-welcome').textContent=`Welcome, ${username}.`;
  panel.querySelector('[data-auth-close]').addEventListener('click',closeStudentAuth);
}

function closeStudentAuth(){
  const stage=authRoot.querySelector('.auth-stage');
  if(!stage)return;
  stage.classList.add('closing');
  setTimeout(()=>{authRoot.replaceChildren();authMode='login';verifiedEmail=''},180);
}

document.addEventListener('student-portal:open',()=>{
  authMode='login';
  renderStudentAuth();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&authRoot.querySelector('.auth-stage'))closeStudentAuth();
});
