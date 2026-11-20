const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const ROOT=__dirname;
const DATA_DIR=path.join(ROOT,'data');
const USERS_FILE=path.join(DATA_DIR,'students.json');
const ADMINS_FILE=path.join(DATA_DIR,'college-admins.json');
const COMPANIES_FILE=path.join(DATA_DIR,'companies.json');
const PLACEMENTS_FILE=path.join(DATA_DIR,'placements.json');
const COHORTS_FILE=path.join(DATA_DIR,'cohorts.json');
const COLLEGES_FILE=path.join(DATA_DIR,'colleges.json');
const SEED_COLLEGES_FILE=path.join(ROOT,'seed','colleges.json');

function loadEnvFile(){
  const file=path.join(ROOT,'.env');
  if(!fs.existsSync(file))return;
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const match=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if(match&&!process.env[match[1]])process.env[match[1]]=match[2].replace(/^("|')(.*)\1$/,'$2');
  }
}
loadEnvFile();

const PORT=Number(process.env.PORT||3000);
const SESSION_SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const DEMO_ADMIN_USERNAME=String(process.env.AKTERRA_DEMO_ADMIN_USERNAME||'').trim().toLowerCase();
const DEMO_ADMIN_PASSWORD=String(process.env.AKTERRA_DEMO_ADMIN_PASSWORD||'');
const OTP_TTL=5*60*1000;
const SESSION_TTL=8*60*60*1000;
const MIN_PLACEMENTS_FOR_PACKAGE_AVERAGE=5;
const PACKAGE_TARGET_LPA=20;
const PLACEMENT_RATE_WEIGHT=0.75;
const PACKAGE_ATTAINMENT_WEIGHT=0.25;
const otpRecords=new Map();
const sendHistory=new Map();
const sessions=new Map();
let mailer=null;
if(process.env.GMAIL_USER&&process.env.GMAIL_APP_PASSWORD){
  try{
    const nodemailer=require('nodemailer');
    mailer=nodemailer.createTransport({service:'gmail',auth:{user:process.env.GMAIL_USER,pass:process.env.GMAIL_APP_PASSWORD}});
  }catch{
    console.error('Gmail OTP is unavailable because nodemailer is missing. Run npm install to enable email verification.');
  }
}

const publicFiles=new Set([
  '/','/index.html','/welcome.css','/cyber.css','/akterra.css','/student-auth.css','/college-auth.css',
  '/company-auth.css','/welcome.js','/student-auth.js','/college-auth.js','/company-auth.js','/assets/akterra-logo.jpeg'
]);
const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.jpeg':'image/jpeg','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml'};

function readJson(file,fallback=[]){
  try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch(error){if(error.code==='ENOENT')return fallback;throw error}
}
function readUsers(){return readJson(USERS_FILE,[])}
function readAdmins(){return readJson(ADMINS_FILE,[])}
function readCompanies(){return readJson(COMPANIES_FILE,[])}
function readPlacements(){return readJson(PLACEMENTS_FILE,[])}
function readCohorts(){return readJson(COHORTS_FILE,[])}
function readColleges(){
  if(fs.existsSync(COLLEGES_FILE))return readJson(COLLEGES_FILE,[]);
  return readJson(SEED_COLLEGES_FILE,[]);
}
function writeJson(file,value){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  fs.writeFileSync(file,JSON.stringify(value,null,2),{encoding:'utf8',mode:0o600});
}
function writeUsers(users){writeJson(USERS_FILE,users)}
function writeAdmins(admins){writeJson(ADMINS_FILE,admins)}
function writeCompanies(companies){writeJson(COMPANIES_FILE,companies)}
function writePlacements(placements){writeJson(PLACEMENTS_FILE,placements)}
function writeCohorts(cohorts){writeJson(COHORTS_FILE,cohorts)}
function writeColleges(colleges){writeJson(COLLEGES_FILE,colleges)}
function sendJson(res,status,body,headers={}){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});
  res.end(JSON.stringify(body));
}
function sendError(res,status,error){sendJson(res,status,{error})}
function readBody(req){
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',chunk=>{raw+=chunk;if(raw.length>20000){reject(new Error('Request is too large.'));req.destroy()}});
    req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'))}catch{reject(new Error('Invalid request body.'))}});
    req.on('error',reject);
  });
}
function normalizeEmail(value){return String(value||'').trim().toLowerCase()}
function validEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
function domainFromEmail(email){return email.split('@').pop().toLowerCase()}
function findCollegeByDomain(domain,colleges=readColleges()){
  const normalized=String(domain||'').trim().toLowerCase();
  return colleges.find(college=>(college.domains||[]).some(item=>item.toLowerCase()===normalized))||null;
}
function collegeForEmail(email,colleges=readColleges()){
  return validEmail(email)?findCollegeByDomain(domainFromEmail(email),colleges):null;
}
function validUsername(value){return /^[a-z0-9][a-z0-9._-]{2,31}$/i.test(String(value||''))}
function uniqueUsername(username,users){return !users.some(user=>user.username.toLowerCase()===username.toLowerCase())}
function hashOtp(code){return crypto.createHash('sha256').update(String(code)).digest('hex')}
function safeEqualText(a,b){
  const left=Buffer.from(String(a));const right=Buffer.from(String(b));
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function checkSendLimit(key){
  const now=Date.now();
  const recent=(sendHistory.get(key)||[]).filter(time=>now-time<60*60*1000);
  if(recent.length>=3||(recent.length&&now-recent[recent.length-1]<60*1000)){sendHistory.set(key,recent);return false}
  recent.push(now);sendHistory.set(key,recent);return true;
}
async function sendOtpEmail(req,email,recordKey,subject){
  if(!mailer)return {status:503,error:'Gmail OTP is not configured. Add the Gmail sender settings to your local .env file.'};
  const rateKey=`${req.socket.remoteAddress||'local'}:${email}`;
  if(!checkSendLimit(rateKey))return {status:429,error:'Please wait before requesting another code. You can request up to 3 codes per hour.'};
  const code=crypto.randomInt(0,1000000).toString().padStart(6,'0');
  try{
    await mailer.sendMail({
      from:`Akterra Placement Universe <${process.env.GMAIL_USER}>`,
      to:email,
      subject,
      text:`Your Akterra verification code is ${code}. It expires in 5 minutes. If you did not request this, ignore this email.`,
      html:`<div style="background:#0b0a0c;color:#ddd;padding:28px;font-family:Arial,sans-serif"><p style="color:#d0445c;letter-spacing:2px">AKTERRA PLACEMENT UNIVERSE</p><h2 style="font-weight:500">Verify your email</h2><p>Use this one-time code to continue:</p><p style="font-size:30px;letter-spacing:8px;color:#f17486"><b>${code}</b></p><p>This code expires in 5 minutes. If you did not request it, ignore this email.</p></div>`
    });
    otpRecords.set(recordKey,{hash:hashOtp(code),expiresAt:Date.now()+OTP_TTL,attempts:0,verified:false});
    return {status:200,sent:true,expiresInSeconds:300};
  }catch(error){
    console.error('Akterra OTP email send failed:',error.message);
    return {status:502,error:'Gmail could not send the code. Check the sender settings and try again.'};
  }
}
function verifyOtp(recordKey,code){
  const record=otpRecords.get(recordKey);
  if(!record||record.expiresAt<Date.now()){otpRecords.delete(recordKey);return {status:400,error:'That code has expired. Request a new Gmail OTP.'}}
  if(record.attempts>=5){otpRecords.delete(recordKey);return {status:429,error:'Too many incorrect attempts. Request a new code.'}}
  if(!/^\d{6}$/.test(String(code||''))||!safeEqualText(record.hash,hashOtp(code))){record.attempts++;return {status:400,error:'That code does not match. Check your email and try again.'}}
  record.verified=true;
  return {status:200,verified:true};
}
function cookieValue(req,name){
  for(const cookie of String(req.headers.cookie||'').split(';')){const [key,...value]=cookie.trim().split('=');if(key===name)return value.join('=')}
  return '';
}
function signSession(id){return crypto.createHmac('sha256',SESSION_SECRET).update(id).digest('hex')}
function createSession(role,user,res,{projectAdmin=false}={}){
  const id=crypto.randomBytes(32).toString('hex');
  sessions.set(id,{userId:user.id,username:user.username,projectAdmin,role,expiresAt:Date.now()+SESSION_TTL});
  const secure=process.env.NODE_ENV==='production'?'; Secure':'';
  res.setHeader('Set-Cookie',`akterra_${role}=${id}.${signSession(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL/1000)}${secure}`);
}
function currentUser(req,role){
  const token=cookieValue(req,`akterra_${role}`);const separator=token.indexOf('.');
  if(separator<1)return null;
  const id=token.slice(0,separator);const signature=token.slice(separator+1);
  if(!safeEqualText(signature,signSession(id)))return null;
  const session=sessions.get(id);
  if(!session||session.role!==role||session.expiresAt<Date.now()){sessions.delete(id);return null}
  if(session.projectAdmin)return projectAdminProfile(role,session.username);
  const records=role==='college'?readAdmins():role==='company'?readCompanies():readUsers();
  return records.find(candidate=>candidate.id===session.userId)||null;
}
function isProjectAdminCredentials(username,password){
  return process.env.NODE_ENV!=='production'&&Boolean(DEMO_ADMIN_USERNAME&&DEMO_ADMIN_PASSWORD.length>=16)&&safeEqualText(String(username||'').trim().toLowerCase(),DEMO_ADMIN_USERNAME)&&safeEqualText(String(password||''),DEMO_ADMIN_PASSWORD);
}
function projectAdminProfile(role,username=DEMO_ADMIN_USERNAME){
  if(role==='college'){
    const college=readColleges()[0];
    return college?{id:'project-admin',username,email:'project-admin@akterra.local',collegeId:college.id,isProjectAdmin:true}:null;
  }
  if(role==='company')return {id:'project-admin',username,email:'project-admin@akterra.local',companyName:'Akterra Project Admin',contactName:'Project Admin',jobTitle:'Demo access',industry:'Education technology',website:'',workDetails:'Local demo access for the company portal.',isProjectAdmin:true};
  return {id:'project-admin',username,email:'project-admin@akterra.local',isProjectAdmin:true};
}
function clearSession(req,res,role){
  const token=cookieValue(req,`akterra_${role}`);sessions.delete(token.split('.')[0]);
  res.setHeader('Set-Cookie',`akterra_${role}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}
function passwordMatches(user,password){
  const derived=crypto.scryptSync(password,user.passwordSalt,64);const expected=Buffer.from(user.passwordHash,'hex');
  return derived.length===expected.length&&crypto.timingSafeEqual(derived,expected);
}
function placementSummary(records){
  const count=records.length;
  const canPublishAverage=count>=MIN_PLACEMENTS_FOR_PACKAGE_AVERAGE;
  const average=canPublishAverage?records.reduce((sum,record)=>sum+record.packageLpa,0)/count:null;
  return {placementCount:count,averagePackageLpa:average===null?null:Number(average.toFixed(2)),packageAverageSuppressed:!canPublishAverage};
}
function makeLeaderboard(){
  const colleges=readColleges().filter(college=>!college.demo);const allPlacements=readPlacements();const cohorts=readCohorts();
  const rows=colleges.map(college=>{
    const collegeCohorts=cohorts.filter(cohort=>cohort.collegeId===college.id);
    const cohortYears=new Set(collegeCohorts.map(cohort=>cohort.graduationYear));
    const eligibleStudentCount=collegeCohorts.reduce((sum,cohort)=>sum+cohort.eligibleStudentCount,0);
    const records=allPlacements.filter(record=>record.collegeId===college.id&&cohortYears.has(record.graduationYear));
    const placementCount=records.length;
    const placementRatePercent=eligibleStudentCount?Math.min(placementCount/eligibleStudentCount,1)*100:null;
    const packageAverageSuppressed=placementCount<MIN_PLACEMENTS_FOR_PACKAGE_AVERAGE;
    const averagePackageLpa=packageAverageSuppressed?null:records.reduce((sum,record)=>sum+record.packageLpa,0)/placementCount;
    const packageAttainmentPercent=averagePackageLpa===null?null:Math.min(averagePackageLpa/PACKAGE_TARGET_LPA,1)*100;
    const provisional=placementRatePercent!==null&&packageAverageSuppressed;
    const score=placementRatePercent===null?null:provisional?placementRatePercent:PLACEMENT_RATE_WEIGHT*placementRatePercent+PACKAGE_ATTAINMENT_WEIGHT*packageAttainmentPercent;
    return {collegeId:college.id,collegeName:college.name,placementCount,eligibleStudentCount,placementRatePercent,averagePackageLpa,packageAverageSuppressed,packageTargetLpa:PACKAGE_TARGET_LPA,score,scoreStatus:placementRatePercent===null?'needs-cohort-size':provisional?'provisional':'final',rankable:placementCount>0&&placementRatePercent!==null};
  });
  rows.sort((a,b)=>Number(b.rankable)-Number(a.rankable)||(b.score??-1)-(a.score??-1)||b.placementRatePercent-b.placementRatePercent||b.placementCount-a.placementCount||(b.averagePackageLpa||0)-(a.averagePackageLpa||0)||a.collegeName.localeCompare(b.collegeName));
  let rank=0;
  return rows.map(row=>({...row,rank:row.rankable?++rank:null,placementRatePercent:row.placementRatePercent===null?null:Number(row.placementRatePercent.toFixed(1)),averagePackageLpa:row.averagePackageLpa===null?null:Number(row.averagePackageLpa.toFixed(2)),score:row.score===null?null:Number(row.score.toFixed(1))}));
}
function createPassword(password){
  const salt=crypto.randomBytes(16).toString('hex');
  return {passwordSalt:salt,passwordHash:crypto.scryptSync(password,salt,64).toString('hex')};
}
function loginError(res,user,password){
  if(!user||password.length>128||!passwordMatches(user,password)){sendError(res,401,'Username or password is incorrect.');return true}
  return false;
}

async function api(req,res,url){
  const route=url.pathname;
  if(req.method==='GET'&&route==='/api/student/college-status'){
    const email=normalizeEmail(url.searchParams.get('email'));
    if(!validEmail(email))return sendJson(res,200,{registered:false,message:'Your college is not registered yet.'});
    const registered=Boolean(collegeForEmail(email));
    return sendJson(res,200,{registered,message:registered?'Your college is registered.':'Your college is not registered yet.'});
  }
  if(req.method==='GET'&&route==='/api/student/username-available'){
    const username=String(url.searchParams.get('username')||'').trim().toLowerCase();
    if(!validUsername(username))return sendJson(res,200,{available:false,reason:'Use 3 to 32 letters, numbers, dots, underscores, or hyphens.'});
    return sendJson(res,200,{available:uniqueUsername(username,readUsers())});
  }
  if(req.method==='GET'&&route==='/api/college/username-available'){
    const username=String(url.searchParams.get('username')||'').trim().toLowerCase();
    if(!validUsername(username))return sendJson(res,200,{available:false,reason:'Use 3 to 32 letters, numbers, dots, underscores, or hyphens.'});
    return sendJson(res,200,{available:uniqueUsername(username,readAdmins())});
  }
  if(req.method==='GET'&&route==='/api/student/me'){
    const user=currentUser(req,'student');return user?sendJson(res,200,{user:{id:user.id,email:user.email,username:user.username}}):sendError(res,401,'Please log in again.');
  }
  if(req.method==='GET'&&route==='/api/college/me'){
    const admin=currentUser(req,'college');
    if(!admin)return sendError(res,401,'Please log in again.');
    const college=readColleges().find(item=>item.id===admin.collegeId);
    return college?sendJson(res,200,{admin:{email:admin.email,username:admin.username},college:{id:college.id,name:college.name,domains:college.domains}}):sendError(res,404,'College workspace not found.');
  }
  if(req.method==='GET'&&route==='/api/college/students'){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const colleges=readColleges();
    const students=readUsers().filter(student=>collegeForEmail(student.email,colleges)?.id===admin.collegeId).sort((a,b)=>String(a.username).localeCompare(String(b.username))).map(student=>({collegeEmailId:student.email,username:student.username,joinedAt:student.createdAt}));
    return sendJson(res,200,{students,privacy:'Only students whose verified email domain belongs to this college are listed. The list contains their college email ID, account username, and registration date.'});
  }
  if(req.method==='GET'&&route==='/api/college/cohorts'){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const placements=readPlacements().filter(record=>record.collegeId===admin.collegeId);
    const cohorts=readCohorts().filter(cohort=>cohort.collegeId===admin.collegeId).sort((a,b)=>b.graduationYear-a.graduationYear).map(cohort=>({...cohort,placedCount:placements.filter(record=>record.graduationYear===cohort.graduationYear).length}));
    return sendJson(res,200,{cohorts,privacy:'Graduating class sizes are private to this college workspace. The public leaderboard shows only aggregate placement rates.'});
  }
  if(req.method==='GET'&&route==='/api/company/me'){
    const company=currentUser(req,'company');
    if(!company)return sendError(res,401,'Please log in again.');
    return sendJson(res,200,{company:{id:company.id,email:company.email,companyName:company.companyName,contactName:company.contactName,jobTitle:company.jobTitle,industry:company.industry,website:company.website,workDetails:company.workDetails}});
  }
  if(req.method==='GET'&&route==='/api/leaderboard'){
    const rows=makeLeaderboard().map(({collegeId,eligibleStudentCount,rankable,...row})=>row);
    return sendJson(res,200,{ranking:'placement-rate-plus-package-attainment',rows});
  }
  if(req.method==='GET'&&route==='/api/college/placements'){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const records=readPlacements().filter(record=>record.collegeId===admin.collegeId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const publicRecords=records.map(({id,studentPublicName,programme,graduationYear,companyName,role,createdAt})=>({id,studentPublicName,programme,graduationYear,companyName,role,createdAt}));
    return sendJson(res,200,{summary:placementSummary(records),records:publicRecords,privacy:'Only non-contact placement information is returned. Package averages are suppressed below five placements, and individual package values are never returned.'});
  }
  if(req.method==='POST'&&route==='/api/student/logout'){
    clearSession(req,res,'student');return sendJson(res,200,{ok:true});
  }
  if(req.method==='POST'&&route==='/api/college/logout'){
    clearSession(req,res,'college');return sendJson(res,200,{ok:true});
  }
  if(req.method==='POST'&&route==='/api/company/logout'){
    clearSession(req,res,'company');return sendJson(res,200,{ok:true});
  }
  if(req.method==='DELETE'&&route.startsWith('/api/college/placements/')){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const id=route.split('/').pop();const placements=readPlacements();
    const existing=placements.find(record=>record.id===id&&record.collegeId===admin.collegeId);
    if(!existing)return sendError(res,404,'Placement record not found.');
    writePlacements(placements.filter(record=>record.id!==id));
    return sendJson(res,200,{deleted:true});
  }
  if(req.method!=='POST')return sendError(res,405,'Method not allowed.');
  let body;
  try{body=await readBody(req)}catch(error){return sendError(res,400,error.message)}

  if(route==='/api/student/send-otp'){
    const email=normalizeEmail(body.email);
    if(!validEmail(email))return sendError(res,400,'Enter a valid college email address.');
    if(!collegeForEmail(email))return sendError(res,403,'Your college is not registered yet.');
    if(readUsers().some(user=>user.email===email))return sendError(res,409,'An account already exists for this email. Log in with its username.');
    const result=await sendOtpEmail(req,email,`student:${email}`,'Your Akterra student verification code');
    return sendJson(res,result.status,result);
  }
  if(route==='/api/student/verify-otp'){
    const email=normalizeEmail(body.email);
    if(!validEmail(email)||!collegeForEmail(email))return sendError(res,403,'Your college is not registered yet.');
    const result=verifyOtp(`student:${email}`,body.code);
    return sendJson(res,result.status,result);
  }
  if(route==='/api/student/register'){
    const email=normalizeEmail(body.email);const username=String(body.username||'').trim().toLowerCase();const password=String(body.password||'');const code=String(body.code||'').trim();
    if(!validEmail(email))return sendError(res,400,'Enter a valid college email address.');
    if(!collegeForEmail(email))return sendError(res,403,'Your college is not registered yet.');
    if(!validUsername(username))return sendError(res,400,'Username must be 3 to 32 characters and use letters, numbers, dots, underscores, or hyphens.');
    if(password.length<8||password.length>128)return sendError(res,400,'Password must be between 8 and 128 characters.');
    const record=otpRecords.get(`student:${email}`);
    if(!record||!record.verified||record.expiresAt<Date.now()||!safeEqualText(record.hash,hashOtp(code)))return sendError(res,400,'Verify your college email with Gmail OTP before registering.');
    const users=readUsers();
    if(users.some(user=>user.email===email))return sendError(res,409,'An account already exists for this email.');
    if(!uniqueUsername(username,users))return sendError(res,409,'That username is already taken. Choose a unique username.');
    const user={id:crypto.randomUUID(),email,username,...createPassword(password),createdAt:new Date().toISOString()};
    users.push(user);writeUsers(users);otpRecords.delete(`student:${email}`);createSession('student',user,res);
    return sendJson(res,201,{created:true,username:user.username});
  }
  if(route==='/api/student/login'){
    const username=String(body.username||'').trim().toLowerCase();const password=String(body.password||'');
    if(isProjectAdminCredentials(username,password)){createSession('student',{id:'project-admin',username},res,{projectAdmin:true});return sendJson(res,200,{ok:true,username,isProjectAdmin:true})}
    const user=readUsers().find(candidate=>candidate.username.toLowerCase()===username);
    const error=loginError(res,user,password);if(error)return error;
    createSession('student',user,res);return sendJson(res,200,{ok:true,username:user.username});
  }

  if(route==='/api/company/register'){
    const email=normalizeEmail(body.email);const companyName=String(body.companyName||'').trim();const contactName=String(body.contactName||'').trim();const jobTitle=String(body.jobTitle||'').trim();const industry=String(body.industry||'').trim();const workDetails=String(body.workDetails||'').trim();const password=String(body.password||'');
    let website=String(body.website||'').trim();
    if(!validEmail(email))return sendError(res,400,'Enter a valid official company email.');
    if(companyName.length<2||companyName.length>120)return sendError(res,400,'Enter the company name.');
    if(contactName.length<2||contactName.length>100)return sendError(res,400,'Enter the contact person name.');
    if(jobTitle.length<2||jobTitle.length>100)return sendError(res,400,'Enter the contact person job title.');
    if(industry.length<2||industry.length>100)return sendError(res,400,'Enter the company industry.');
    if(workDetails.length<10||workDetails.length>2000)return sendError(res,400,'Add a short description of your work and hiring needs.');
    if(password.length<8||password.length>128)return sendError(res,400,'Password must be between 8 and 128 characters.');
    if(website){try{if(!/^https?:\/\//i.test(website))website=`https://${website}`;const parsed=new URL(website);if(!['http:','https:'].includes(parsed.protocol))throw new Error();website=parsed.toString()}catch{return sendError(res,400,'Enter a valid company website URL.') }}
    const companies=readCompanies();
    if(companies.some(company=>company.email===email))return sendError(res,409,'An account already exists for this email. Log in with your company email.');
    const company={id:crypto.randomUUID(),email,companyName,contactName,jobTitle,industry,website,workDetails,...createPassword(password),createdAt:new Date().toISOString()};
    companies.push(company);writeCompanies(companies);createSession('company',company,res);
    return sendJson(res,201,{created:true,companyName:company.companyName});
  }
  if(route==='/api/company/login'){
    const loginId=String(body.email||body.username||'').trim();const password=String(body.password||'');
    if(isProjectAdminCredentials(loginId,password)){createSession('company',{id:'project-admin',username:DEMO_ADMIN_USERNAME},res,{projectAdmin:true});return sendJson(res,200,{ok:true,companyName:'Akterra Project Admin',isProjectAdmin:true})}
    const email=normalizeEmail(loginId);
    const company=readCompanies().find(candidate=>candidate.email===email);
    const error=loginError(res,company,password);if(error)return error;
    createSession('company',company,res);return sendJson(res,200,{ok:true,companyName:company.companyName});
  }

  if(route==='/api/college/send-otp'){
    const email=normalizeEmail(body.email);const domain=domainFromEmail(email);const college=validEmail(email)?findCollegeByDomain(domain):null;
    if(!validEmail(email))return sendError(res,400,'Enter a valid college email address.');
    if(college&&(college.admins||[]).length>0)return sendError(res,409,'This college is already registered. Use the College Admin login.');
    if(readAdmins().some(admin=>admin.email===email))return sendError(res,409,'An admin account already exists for this email.');
    const result=await sendOtpEmail(req,email,`college-register:${email}`,'Verify your Akterra college admin email');
    return sendJson(res,result.status,result);
  }
  if(route==='/api/college/verify-otp'){
    const email=normalizeEmail(body.email);
    if(!validEmail(email))return sendError(res,400,'Enter a valid college email address.');
    const result=verifyOtp(`college-register:${email}`,body.code);
    return sendJson(res,result.status,result);
  }
  if(route==='/api/college/register'){
    const email=normalizeEmail(body.email);const collegeName=String(body.collegeName||'').trim();const username=String(body.username||'').trim().toLowerCase();const password=String(body.password||'');const code=String(body.code||'').trim();
    if(!validEmail(email))return sendError(res,400,'Enter a valid official college email address.');
    if(collegeName.length<3||collegeName.length>120)return sendError(res,400,'Enter your college name.');
    if(!validUsername(username))return sendError(res,400,'Username must be 3 to 32 characters and use letters, numbers, dots, underscores, or hyphens.');
    if(password.length<8||password.length>128)return sendError(res,400,'Password must be between 8 and 128 characters.');
    const record=otpRecords.get(`college-register:${email}`);
    if(!record||!record.verified||record.expiresAt<Date.now()||!safeEqualText(record.hash,hashOtp(code)))return sendError(res,400,'Verify your official college email with Gmail OTP first.');
    const admins=readAdmins();
    if(admins.some(admin=>admin.email===email))return sendError(res,409,'An admin account already exists for this email.');
    if(!uniqueUsername(username,admins))return sendError(res,409,'That username is already taken. Choose a unique username.');
    const colleges=readColleges();const domain=domainFromEmail(email);let college=findCollegeByDomain(domain,colleges);
    if(college&&(college.admins||[]).length>0)return sendError(res,409,'This college is already registered. Use the College Admin login.');
    if(!college){college={id:crypto.randomUUID(),name:collegeName,domains:[],admins:[]};colleges.push(college)}
    else college.name=collegeName;
    if(!college.domains.includes(domain))college.domains.push(domain);
    const admin={id:crypto.randomUUID(),email,username,collegeId:college.id,...createPassword(password),createdAt:new Date().toISOString()};
    college.admins=college.admins||[];college.admins.push(admin.id);admins.push(admin);
    writeColleges(colleges);writeAdmins(admins);otpRecords.delete(`college-register:${email}`);createSession('college',admin,res);
    return sendJson(res,201,{created:true,username:admin.username,college:college.name});
  }
  if(route==='/api/college/login'){
    const username=String(body.username||'').trim().toLowerCase();const password=String(body.password||'');
    if(isProjectAdminCredentials(username,password)){createSession('college',{id:'project-admin',username},res,{projectAdmin:true});return sendJson(res,200,{ok:true,username,isProjectAdmin:true})}
    const admin=readAdmins().find(candidate=>candidate.username.toLowerCase()===username);
    const error=loginError(res,admin,password);if(error)return error;
    createSession('college',admin,res);return sendJson(res,200,{ok:true,username:admin.username});
  }
  if(route==='/api/college/placements'){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const studentPublicName=String(body.studentPublicName||'').trim();
    const programme=String(body.programme||'').trim();
    const graduationYear=Number(body.graduationYear);
    const companyName=String(body.companyName||'').trim();
    const role=String(body.role||'').trim();
    const packageLpa=Number(body.packageLpa);
    if(body.publicDataApproved!==true)return sendError(res,400,'Confirm that this is one placed student and the record contains no private contact details or student IDs.');
    if(studentPublicName.length>100)return sendError(res,400,'Keep the public name under 100 characters.');
    if(programme.length<2||programme.length>120)return sendError(res,400,'Enter the student programme or department.');
    if(!Number.isInteger(graduationYear)||graduationYear<2000||graduationYear>2100)return sendError(res,400,'Enter a valid graduation year.');
    if(companyName.length<2||companyName.length>120)return sendError(res,400,'Enter the hiring company.');
    if(role.length<2||role.length>120)return sendError(res,400,'Enter the selected role.');
    if(!Number.isFinite(packageLpa)||packageLpa<=0||packageLpa>1000)return sendError(res,400,'Enter a package between 0.01 and 1000 LPA.');
    const placements=readPlacements();
    const cohort=readCohorts().find(item=>item.collegeId===admin.collegeId&&item.graduationYear===graduationYear);
    const placedThisYear=placements.filter(item=>item.collegeId===admin.collegeId&&item.graduationYear===graduationYear).length;
    if(cohort&&placedThisYear>=cohort.eligibleStudentCount)return sendError(res,409,'This class already has as many placement records as its reported graduating class size. Update the class size if it is incorrect.');
    const record={id:crypto.randomUUID(),collegeId:admin.collegeId,studentPublicName,programme,graduationYear,companyName,role,packageLpa:Number(packageLpa.toFixed(2)),createdAt:new Date().toISOString()};
    placements.push(record);writePlacements(placements);
    return sendJson(res,201,{added:true,summary:placementSummary(placements.filter(item=>item.collegeId===admin.collegeId))});
  }
  if(route==='/api/college/cohorts'){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const graduationYear=Number(body.graduationYear);const eligibleStudentCount=Number(body.eligibleStudentCount);
    if(!Number.isInteger(graduationYear)||graduationYear<2000||graduationYear>2100)return sendError(res,400,'Enter a valid graduating class year.');
    if(!Number.isInteger(eligibleStudentCount)||eligibleStudentCount<1||eligibleStudentCount>100000)return sendError(res,400,'Enter the total graduating class size as a whole number from 1 to 100,000.');
    const placements=readPlacements().filter(record=>record.collegeId===admin.collegeId&&record.graduationYear===graduationYear);
    if(eligibleStudentCount<placements.length)return sendError(res,400,`Class size cannot be lower than its ${placements.length} recorded placements.`);
    const cohorts=readCohorts();const existing=cohorts.find(cohort=>cohort.collegeId===admin.collegeId&&cohort.graduationYear===graduationYear);
    if(existing){existing.eligibleStudentCount=eligibleStudentCount;existing.updatedAt=new Date().toISOString()}
    else cohorts.push({id:crypto.randomUUID(),collegeId:admin.collegeId,graduationYear,eligibleStudentCount,updatedAt:new Date().toISOString()});
    writeCohorts(cohorts);
    return sendJson(res,200,{saved:true,graduationYear,eligibleStudentCount});
  }
  if(route==='/api/college/domain/send-otp'){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const email=normalizeEmail(body.email);if(!validEmail(email))return sendError(res,400,'Enter a valid email address at the domain you want to add.');
    const domain=domainFromEmail(email);const colleges=readColleges();const existing=findCollegeByDomain(domain,colleges);
    if(existing)return sendError(res,409,existing.id===admin.collegeId?'That domain is already added to your college.':'That domain is already registered with another college.');
    const result=await sendOtpEmail(req,email,`college-domain:${admin.id}:${email}`,'Verify a new Akterra college domain');
    return sendJson(res,result.status,result);
  }
  if(route==='/api/college/domain/add'){
    const admin=currentUser(req,'college');if(!admin)return sendError(res,401,'Log in to the College Admin portal first.');
    const email=normalizeEmail(body.email);const code=String(body.code||'').trim();
    if(!validEmail(email))return sendError(res,400,'Enter a valid email address at the domain you want to add.');
    const recordKey=`college-domain:${admin.id}:${email}`;const record=otpRecords.get(recordKey);
    if(!record||!record.verified||record.expiresAt<Date.now()||!safeEqualText(record.hash,hashOtp(code)))return sendError(res,400,'Verify an email at this domain with Gmail OTP first.');
    const colleges=readColleges();const college=colleges.find(item=>item.id===admin.collegeId);
    if(!college)return sendError(res,404,'College workspace not found.');
    const domain=domainFromEmail(email);const existing=findCollegeByDomain(domain,colleges);
    if(existing)return sendError(res,409,existing.id===college.id?'That domain is already added to your college.':'That domain is already registered with another college.');
    college.domains.push(domain);writeColleges(colleges);otpRecords.delete(recordKey);
    return sendJson(res,200,{added:true,domain,college:college.name});
  }
  return sendError(res,404,'API route not found.');
}

async function serveStatic(req,res,url){
  const requested=url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname);
  if(!publicFiles.has(requested))return sendError(res,404,'Not found.');
  const file=path.join(ROOT,requested.replace(/^\//,''));
  try{
    const content=await fs.promises.readFile(file);
    res.writeHead(200,{'Content-Type':contentTypes[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY'});
    res.end(content);
  }catch{sendError(res,404,'Not found.')}
}

const handleRequest=(req,res)=>{
  let url;
  try{url=new URL(req.url,'http://localhost')}catch{return sendError(res,400,'Invalid request URL.')}
  if(url.pathname.startsWith('/api/'))api(req,res,url).catch(error=>{console.error('Akterra API error:',error.message);if(!res.headersSent)sendError(res,500,'A server error occurred.')});
  else serveStatic(req,res,url).catch(()=>sendError(res,500,'Could not load this page.'));
};

let serverReady=false;
for(const host of ['127.0.0.1','::1']){
  const server=http.createServer(handleRequest);
  server.on('error',error=>console.error(`Akterra could not listen on ${host}:${PORT}: ${error.message}`));
  server.listen(PORT,host,()=>{
    if(serverReady)return;
    serverReady=true;
    console.log(`Akterra is running at http://localhost:${PORT}`);
    if(!mailer)console.log('Gmail OTP is unavailable until .env contains GMAIL_USER and GMAIL_APP_PASSWORD.');
    console.log(`Registered college count: ${readColleges().length}`);
  });
}
