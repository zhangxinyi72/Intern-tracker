let db = {
  apps: [],
  contacts: [],
  prep: [],
  config: {
    theme: 'light',
    weeklyGoal: 10,
    resumeKeywords: '',
    lastEditedAt: null,
    ideaTags: ['Idea','Blocker','Win','Learn','Next Action','Review','Report']
  },
  time: { sessions: [], active: null, pomodoro: null, ideas: [] }
};

const STORAGE_KEY = 'lucy_tracker_v9';
const TAG_OPTIONS = ['Deep Work','Admin','Learn','Interview Prep','Other'];
const VALUE_COMPANIES = ['Google','Meta','Apple','Amazon','Microsoft','OpenAI','Netflix','Nvidia','Tesla','ByteDance','TikTok'];

const KEYWORD_LIBRARY = [
  "sql","python","pandas","numpy","statistics","experiment","experimentation","a/b test","ab test","ab testing","hypothesis",
  "attribution","conversion","funnel","cohort","retention","segmentation","kpi","dashboard","reporting","insight",
  "etl","pipeline","data pipeline","data warehouse","warehouse","snowflake","bigquery","redshift","spark",
  "airflow","dbt","tableau","looker","lookml","power bi","excel",
  "ga4","google analytics","mixpanel","amplitude","firebase","event tracking","instrumentation",
  "regression","classification","clustering","forecast","time series","causal inference",
  "stakeholder","cross-functional","presentation","storytelling"
];

function ensureMilestones(app){
  if(!app || typeof app !== 'object') return;
  if(!app.milestones || typeof app.milestones !== 'object'){
    app.milestones = { screenAt: null, interviewAt: null, offerAt: null };
  } else {
    if(!('screenAt' in app.milestones)) app.milestones.screenAt = null;
    if(!('interviewAt' in app.milestones)) app.milestones.interviewAt = null;
    if(!('offerAt' in app.milestones)) app.milestones.offerAt = null;
  }
}

function hasScreen(app){ ensureMilestones(app); return !!app.milestones.screenAt; }
function hasInterview(app){ ensureMilestones(app); return !!app.milestones.interviewAt || !!app.milestones.offerAt; }
function hasOffer(app){ ensureMilestones(app); return !!app.milestones.offerAt; }

function applyMilestone(app, status, tsISO){
  ensureMilestones(app);
  const ts = tsISO || new Date().toISOString();

  if(status === 'Screen'){
    if(!app.milestones.screenAt) app.milestones.screenAt = ts;
  }
  if(status === 'Interview'){
    if(!app.milestones.interviewAt) app.milestones.interviewAt = ts;
  }
  if(status === 'Offer'){
    if(!app.milestones.offerAt) app.milestones.offerAt = ts;
    if(!app.milestones.interviewAt) app.milestones.interviewAt = ts;
  }
}

function highestReachedStage(app){
  ensureMilestones(app);
  if(app.milestones.offerAt) return 'Offer';
  if(app.milestones.interviewAt) return 'Interview';
  if(app.milestones.screenAt) return 'Screen';
  return '';
}

function normalizeRejectStage(app){
  if(!app) return;
  if(app.status !== 'Reject') return;

  ensureMilestones(app);

  if(!app.rejectStage){
    const inferred = highestReachedStage(app);
    app.rejectStage = inferred || '';
  }

  const ts = app.rejectedAt || (app.date ? dateOnlyToISO(app.date) : new Date().toISOString());

  if(app.rejectStage === 'Screen') applyMilestone(app, 'Screen', ts);
  if(app.rejectStage === 'Interview') applyMilestone(app, 'Interview', ts);
  if(app.rejectStage === 'Offer') applyMilestone(app, 'Offer', ts);
}

function deriveMilestonesFromHistoryIfAny(app){
  if(!app) return;
  ensureMilestones(app);

  if(Array.isArray(app.history) && app.history.length){
    const mapFirst = { Screen: null, Interview: null, Offer: null };
    app.history.forEach(h => {
      const st = (h && h.status) ? h.status : null;
      const ts = (h && h.ts) ? h.ts : null;
      if(!st || !ts) return;
      if(st === 'Screen' && !mapFirst.Screen) mapFirst.Screen = ts;
      if(st === 'Interview' && !mapFirst.Interview) mapFirst.Interview = ts;
      if(st === 'Offer' && !mapFirst.Offer) mapFirst.Offer = ts;
    });

    if(mapFirst.Screen && !app.milestones.screenAt) app.milestones.screenAt = mapFirst.Screen;
    if(mapFirst.Interview && !app.milestones.interviewAt) app.milestones.interviewAt = mapFirst.Interview;
    if(mapFirst.Offer && !app.milestones.offerAt) app.milestones.offerAt = mapFirst.Offer;

    if(app.milestones.offerAt && !app.milestones.interviewAt){
      app.milestones.interviewAt = app.milestones.offerAt;
    }
  }
}

function backfillMilestonesFromCurrentStatus(app){
  if(!app) return;
  ensureMilestones(app);
  const ts = (app.date ? dateOnlyToISO(app.date) : new Date().toISOString());
  if(app.status === 'Screen' || app.status === 'Interview' || app.status === 'Offer'){
    applyMilestone(app, app.status, ts);
  }
  if(app.status === 'Reject'){
    normalizeRejectStage(app);
  }
}

function onStatusChange(app, oldStatus, newStatus){
  if(!app) return;
  const now = new Date().toISOString();
  app.statusUpdatedAt = now;

  if(newStatus === 'Interview' && !app.interviewResult){
    app.interviewResult = 'pending';
  }

  if(newStatus === 'Screen' || newStatus === 'Interview' || newStatus === 'Offer'){
    applyMilestone(app, newStatus, now);
  }

  if(newStatus === 'Reject'){
    if(!app.rejectedAt) app.rejectedAt = now;
    normalizeRejectStage(app);
  }
}

function boardColumnStatus(app){
  const cols = ['Applied','Screen','Interview','Offer','Reject'];
  if(app.status === 'Reject' && app.rejectStage && cols.includes(app.rejectStage)){
    return app.rejectStage;
  }
  return cols.includes(app.status) ? app.status : 'Applied';
}

function init() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    db = JSON.parse(saved);
    normalizeDb();
  } else {
    initPrepDefaults();
    db.config.weeklyGoal = 10;
    db.config.resumeKeywords = '';
    db.config.lastEditedAt = null;
    db.time = { sessions: [], active: null, pomodoro: null, ideas: [] };
    save(true);
  }

  applyTheme(db.config.theme);
  renderBoard();
  renderStats();
  renderReminders();
  renderWeeklyInsight();
  renderPriorityPanel();
  renderCompareView();
  renderHeaderMeta();
  startLiveClock();
}

function normalizeDb() {
  if (!db.prep || db.prep.length === 0) initPrepDefaults();
  if (!db.contacts) db.contacts = [];
  if (!db.config) db.config = { theme: 'light', weeklyGoal: 10, resumeKeywords: '', lastEditedAt: null, ideaTags: [] };
  if (!db.config.weeklyGoal) db.config.weeklyGoal = 10;
  if (db.config.resumeKeywords === undefined) db.config.resumeKeywords = '';
  if (db.config.lastEditedAt === undefined) db.config.lastEditedAt = null;

  if (!Array.isArray(db.config.ideaTags) || db.config.ideaTags.length === 0) {
    db.config.ideaTags = ['Idea','Blocker','Win','Learn','Next Action','Review'];
  }

  if (!db.time) db.time = { sessions: [], active: null, pomodoro: null, ideas: [] };
  if (!Array.isArray(db.time.sessions)) db.time.sessions = [];
  if (!Array.isArray(db.time.ideas)) db.time.ideas = [];
  if (db.time.active === undefined) db.time.active = null;

  db.time.ideas = (db.time.ideas || []).map(i => ({
    id: i.id || Date.now().toString(),
    date: i.date || isoToLocalDateStr(i.createdAt || new Date().toISOString()),
    tag: i.tag || 'Idea',
    title: i.title || '',
    summary: i.summary || '',
    content: i.content || '',
    review: i.review || '',
    next: i.next || '',
    createdAt: i.createdAt || new Date().toISOString(),
    updatedAt: i.updatedAt || null,
    archived: !!i.archived,
    completed: !!i.completed,
    archivedAt: i.archivedAt || null,
    completedAt: i.completedAt || null,
    collapsed: (i.collapsed === undefined) ? true : !!i.collapsed,
    reportKey: i.reportKey || null
  }));

  if(!db.config.ideaTags.includes('Report')) db.config.ideaTags.push('Report');

  db.time.sessions.forEach(s=>{
    if(!s.tag) s.tag = 'Other';
    if(!s.primaryActivity) s.primaryActivity = getPrimaryActivity(s);
    if(!('output' in s)) s.output = '';
  });

  const today = new Date().toISOString().split('T')[0];

  db.apps = (db.apps || []).map(a => {
    const appliedDate = a.appliedDate || a.date || today;

    const app = {
      id: a.id || Date.now().toString(),
      company: a.company || '',
      role: a.role || '',
      status: a.status || 'Applied',
      date: a.date || today,
      appliedDate: appliedDate,
      link: a.link || '',
      nextStep: a.nextStep || '',
      desc: a.desc || '',
      resumeVersion: a.resumeVersion || 'Other',
      tags: Array.isArray(a.tags) ? a.tags : (typeof a.tags === 'string' ? parseTags(a.tags) : []),
      rejectReason: a.rejectReason || '',
      track: a.track || 'A-Data',
      source: a.source || 'Company Site',
      remindersDone: (a.remindersDone && typeof a.remindersDone === 'object') ? a.remindersDone : {},
      rejectStage: a.rejectStage || '',
      milestones: (a.milestones && typeof a.milestones === 'object') ? a.milestones : { screenAt: null, interviewAt: null, offerAt: null },
      statusUpdatedAt: a.statusUpdatedAt || (a.date ? dateOnlyToISO(a.date) : new Date().toISOString()),
      rejectedAt: a.rejectedAt || null,
      interviewResult: a.interviewResult || 'pending'
    };

    if(Array.isArray(a.history) && a.history.length){
      app.history = a.history;
      deriveMilestonesFromHistoryIfAny(app);
      delete app.history;
    }

    ensureMilestones(app);
    backfillMilestonesFromCurrentStatus(app);
    if(app.status === 'Reject') normalizeRejectStage(app);

    return app;
  });

  save(true);
}

function save(silent = false) {
  if(!silent){
    db.config.lastEditedAt = new Date().toISOString();
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

  if (!silent) {
    renderStats();
    renderReminders();
    renderWeeklyInsight();
    renderPriorityPanel();
    renderHeaderMeta();
  }

  if (document.getElementById('view-board')?.classList.contains('active')) {
    renderCompareView();
  }

  if (document.getElementById('view-settings')?.classList.contains('active')) {
    renderABSummary();
    renderTrackSummary();
    renderSourcePerformance();
    renderInterviewFunnel();
    renderPipelineHealth();
    const el = document.getElementById('cfg-resume-keywords');
    if (el) el.value = db.config.resumeKeywords || '';
  }

  if (document.getElementById('view-time')?.classList.contains('active')) {
    renderTimeView();
  }

  if (document.getElementById('view-ideas')?.classList.contains('active')) {
    renderIdeas();
  }
}

let _clockTimer = null;

function renderHeaderMeta(){
  updateClockOnce();
  updateLastUpdatedOnce();
}

function updateClockOnce(){
  const el = document.getElementById('live-clock');
  if(!el) return;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const now = new Date();
  const text = now.toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    month: 'short',
    day: '2-digit',
    timeZoneName: 'short'
  });

  el.textContent = `🕒 ${text}`;
  el.title = `Time zone: ${tz}`;
}

function updateLastUpdatedOnce(){
  const btn = document.getElementById('last-updated-btn');
  if(!btn) return;

  if(!db.config.lastEditedAt){
    btn.textContent = 'Updated —';
    return;
  }
  const diffMs = Date.now() - new Date(db.config.lastEditedAt).getTime();
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);

  let label = 'Just now';
  if(mins >= 1 && mins < 60) label = `${mins}m ago`;
  if(mins >= 60) label = `${hrs}h ${mins%60}m ago`;

  btn.textContent = `Updated ${label}`;
}

function showLastUpdated(){
  if(!db.config.lastEditedAt) return alert('No edit timestamp yet.');
  alert(`Last updated: ${new Date(db.config.lastEditedAt).toLocaleString()}\nISO: ${db.config.lastEditedAt}`);
}

function startLiveClock(){
  if(_clockTimer) clearInterval(_clockTimer);
  _clockTimer = setInterval(()=>{
    updateClockOnce();
    updateLastUpdatedOnce();
  }, 1000);
}

function initPrepDefaults() {
  db.prep = [];
  const plans = [
    { t: "Week 1: Foundations", tasks: ["Finalize Resume (Master Version)", "Update LinkedIn Profile (Headline & About)", "Set up Job Alerts (LinkedIn/Glassdoor)", "Start 'SQL 50' on LeetCode"] },
    { t: "Week 2: Initial Pipeline", tasks: ["Apply to 15 Tier-2 Companies (Warm-up)", "Reach out to 5 Alumni on LinkedIn", "Complete SQL 50", "Draft Cover Letter Template"] },
    { t: "Week 3: Momentum", tasks: ["Apply to 20 Companies", "Follow up on Week 1 Applications", "Start Python/Pandas Review", "Have 1 Informational Chat"] },
    { t: "Week 4: Tier 1 Focus", tasks: ["Apply to 5 Dream Companies", "Customize Resume for Dream Roles", "Mock Interview (Behavioral)", "Network: 5 New Outreach"] },
    { t: "Week 5: Interview Prep", tasks: ["Review 'STAR' Method Stories", "Deep Dive: A/B Testing Concepts", "Apply 20+ Maintenance", "Check Application Statuses"] },
    { t: "Week 6: Mid-Season Push", tasks: ["Analyze Rejections (Adjust Strategy?)", "Apply to 20 Companies", "Advanced SQL Practice", "Network: Follow up previous chats"] },
    { t: "Week 7: Technical Deep Dive", tasks: ["Python Data Case Study Practice", "Product Sense Interview Prep", "Apply 20 Companies", "Clean up Portfolio/GitHub"] },
    { t: "Week 8: Closing", tasks: ["Follow up on all outstanding apps", "Prepare 'Questions for Interviewer'", "Apply 15 Companies", "Rest/Mental Health Check"] }
  ];

  const start = new Date();
  const day = start.getDay();
  const diff = start.getDate() - day + (day == 0 ? -6 : 1);
  const monday = new Date(start.setDate(diff));

  plans.forEach((p, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i * 7);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    db.prep.push({
      id: Date.now() + i,
      title: `${p.t} (${dateStr})`,
      tasks: p.tasks.map(txt => ({ text: txt, done: false }))
    });
  });
}

function renderPrep() {
  const div = document.getElementById('prep-container');
  div.innerHTML = '';
  if (db.prep.length === 0) {
    div.innerHTML = '<div style="text-align:center; padding:20px"><button class="btn btn-primary" onclick="initPrepDefaults(); location.reload()">Load Battle Plan</button></div>';
    return;
  }

  db.prep.forEach((wk, wIdx) => {
    div.innerHTML += `
      <div class="prep-card">
        <div class="prep-week-header">
          <span>${escapeHtml(wk.title)}</span>
          <div>
            <button class="btn btn-ghost" style="padding:2px 8px; font-size:0.8rem; height:auto" onclick="renameWeek(${wIdx})">✏️ Rename</button>
            <button class="btn btn-ghost" style="padding:2px 8px; height:auto" onclick="addPrepTask(${wIdx})">+ Task</button>
          </div>
        </div>
        ${wk.tasks.map((t, tIdx) => `
          <div class="task-row ${t.done ? 'done' : ''}">
            <input type="checkbox" class="task-cb" ${t.done ? 'checked' : ''} onchange="togglePrep(${wIdx},${tIdx})">
            <input class="task-input" id="task-${wIdx}-${tIdx}" value="${escapeAttr(t.text)}" onchange="editPrep(${wIdx},${tIdx},this.value)" placeholder="Task description...">
            <div class="task-actions">
              <button class="icon-btn" onclick="focusTask(${wIdx},${tIdx})">✏️</button>
              <button class="icon-btn delete" onclick="delPrep(${wIdx},${tIdx})">🗑️</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  });
  div.innerHTML += `<button class="btn btn-ghost" style="width:100%" onclick="addWeek()">+ Add New Week Plan</button>`;
}

function togglePrep(w, t) { db.prep[w].tasks[t].done = !db.prep[w].tasks[t].done; save(); renderPrep(); }
function editPrep(w, t, val) { db.prep[w].tasks[t].text = val; save(); }
function addPrepTask(w) { db.prep[w].tasks.push({ text: "", done: false }); save(); renderPrep(); }
function delPrep(w, t) { db.prep[w].tasks.splice(t, 1); save(); renderPrep(); }
function focusTask(w, t) { document.getElementById(`task-${w}-${t}`).focus(); }
function renameWeek(w) { const n = prompt("Rename Week:", db.prep[w].title); if (n) { db.prep[w].title = n; save(); renderPrep(); } }
function addWeek() { db.prep.push({ title: "New Week", tasks: [{ text: "New Task", done: false }] }); save(); renderPrep(); }

function renderNet() {
  const div = document.getElementById('net-container');
  div.innerHTML = '';
  if (db.contacts.length === 0) {
    div.innerHTML = `<div style="text-align:center; color:var(--text-sub); padding:20px">No contacts yet. Click "+ Add Contact" to start building relationships.</div>`;
    return;
  }
  db.contacts.forEach(c => {
    div.innerHTML += `
      <div class="net-card">
        <div class="net-info" style="flex:1">
          <h3>${escapeHtml(c.name)} <span style="font-weight:400; color:var(--text-sub)">@ ${escapeHtml(c.co)}</span></h3>
          <div style="margin-bottom:8px">
            ${c.field ? `<span class="net-tag">🏷️ ${escapeHtml(c.field)}</span>` : ''}
          </div>
          ${c.notes ? `<div class="net-notes">📝 ${escapeHtml(c.notes)}</div>` : ''}
          <div style="display:flex; gap:15px; margin-top:10px;">
            ${c.date ? `<span class="net-date">Last: ${escapeHtml(c.date)}</span>` : ''}
            ${c.next ? `<span class="net-next">📅 Next: ${escapeHtml(c.next)}</span>` : ''}
          </div>
        </div>
        <button class="btn btn-ghost" style="height:44px" onclick="openNetModal('${c.id}')">Edit</button>
      </div>
    `;
  });
}

function openNetModal(id = null) {
  document.getElementById('modal-net').style.display = 'flex';
  if (id) {
    const c = db.contacts.find(x => x.id === id);
    document.getElementById('net-id').value = id;
    document.getElementById('net-name').value = c.name || '';
    document.getElementById('net-co').value = c.co || '';
    document.getElementById('net-field').value = c.field || '';
    document.getElementById('net-notes').value = c.notes || '';
    document.getElementById('net-date').value = c.date || '';
    document.getElementById('net-next').value = c.next || '';
    document.getElementById('net-modal-title').innerText = 'Edit Contact';
  } else {
    document.getElementById('net-id').value = '';
    document.getElementById('net-name').value = '';
    document.getElementById('net-co').value = '';
    document.getElementById('net-field').value = '';
    document.getElementById('net-notes').value = '';
    document.getElementById('net-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('net-next').value = '';
    document.getElementById('net-modal-title').innerText = 'New Contact';
  }
}

function saveContact() {
  const id = document.getElementById('net-id').value;
  const contact = {
    id: id || Date.now().toString(),
    name: document.getElementById('net-name').value,
    co: document.getElementById('net-co').value,
    field: document.getElementById('net-field').value,
    notes: document.getElementById('net-notes').value,
    date: document.getElementById('net-date').value,
    next: document.getElementById('net-next').value
  };

  if (id) {
    const idx = db.contacts.findIndex(c => c.id === id);
    db.contacts[idx] = contact;
  } else {
    db.contacts.push(contact);
  }
  save(); closeModal('modal-net'); renderNet();
}

function deleteContact() {
  const id = document.getElementById('net-id').value;
  if (id && confirm("Delete contact?")) {
    db.contacts = db.contacts.filter(c => c.id !== id);
    save(); closeModal('modal-net'); renderNet();
  }
}

function renderABSummary() {
  const div = document.getElementById('ab-summary');
  if (!div) return;

  const versions = ['A', 'B', 'Other'];
  const totalApplied = db.apps.length;

  const summary = versions.map(v => {
    const apps = db.apps.filter(a => (a.resumeVersion || 'Other') === v);
    const applied = apps.length;
    const interviews = apps.filter(a => hasInterview(a)).length;
    const offers = apps.filter(a => hasOffer(a)).length;

    const interviewRate = applied ? (interviews / applied) : 0;
    const offerRate = applied ? (offers / applied) : 0;

    return { v, applied, interviews, offers, interviewRate, offerRate };
  });

  div.innerHTML = summary.map(s => `
    <div class="ab-card">
      <div class="ab-title">Resume ${s.v}</div>
      <div class="ab-metric"><span>Applied</span><b>${s.applied}</b></div>
      <div class="ab-metric"><span>Interview (Ever)</span><b>${s.interviews}</b></div>
      <div class="ab-metric"><span>Offers (Ever)</span><b>${s.offers}</b></div>
      <div class="divider"></div>
      <div class="ab-metric"><span>Interview Rate</span><b>${(s.interviewRate*100).toFixed(1)}%</b></div>
      <div class="ab-metric"><span>Offer Rate</span><b>${(s.offerRate*100).toFixed(1)}%</b></div>
      <div class="small-note">Share of total: ${totalApplied ? ((s.applied/totalApplied)*100).toFixed(1) : '0.0'}%</div>
    </div>
  `).join('');
}

function renderTrackSummary(){
  const div = document.getElementById('track-summary');
  if(!div) return;

  const tracks = ["A-Data","B-Product"];
  const summary = tracks.map(t => {
    const apps = db.apps.filter(a => (a.track || "A-Data") === t);
    const applied = apps.length;
    const interviews = apps.filter(a => hasInterview(a)).length;
    const rate = applied ? (interviews/applied) : 0;
    return { t, applied, interviews, rate };
  });

  div.innerHTML = summary.map(s => `
    <div class="ab-card">
      <div class="ab-title">${s.t === "A-Data" ? "Track A — Data" : "Track B — Product"}</div>
      <div class="ab-metric"><span>Applied</span><b>${s.applied}</b></div>
      <div class="ab-metric"><span>Interview (Ever)</span><b>${s.interviews}</b></div>
      <div class="divider"></div>
      <div class="ab-metric"><span>Interview Rate</span><b>${(s.rate*100).toFixed(1)}%</b></div>
      <div class="small-note">Tip: 把时间押在 interview rate 更高的 Track。</div>
    </div>
  `).join('');
}

function getWeekStartMonday(d){
  const date = new Date(d);
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0,0,0,0);
  return date;
}
function getWeekEndSunday(monday){
  const end = new Date(monday);
  end.setDate(monday.getDate() + 6);
  end.setHours(23,59,59,999);
  return end;
}
function computeWeekMetrics(start, end){
  const appliedApps = (db.apps || []).filter(a=>{
    const ds = a.appliedDate || a.date;
    if(!ds) return false;
    const [y,m,d] = ds.split('-').map(Number);
    const dt = new Date(y, m-1, d, 12, 0, 0);
    return dt >= start && dt <= end;
  });

  const applied = appliedApps.length;
  const interviews = appliedApps.filter(a=>hasInterview(a)).length;

  const sessions = (db.time?.sessions || []).filter(s=>{
    const st = getSessionStart(s);
    if(!st) return false;
    const dt = new Date(st);
    return dt >= start && dt <= end;
  });

  let focusMs = 0;
  sessions.forEach(s=>{
    const { bucket, total } = calcSessionDurations(s);
    focusMs += Math.max(0, total - (bucket['Break'] || 0));
  });

  return { applied, interviews, focusMs };
}

function renderCompareView(){
  const panel = document.getElementById('compare-panel');
  const grid = document.getElementById('compare-grid');
  const period = document.getElementById('compare-period');
  if(!panel || !grid || !period) return;

  const today = new Date();
  const thisMon = getWeekStartMonday(today);
  const thisSun = getWeekEndSunday(thisMon);
  const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
  const lastSun = getWeekEndSunday(lastMon);

  const tw = computeWeekMetrics(thisMon, thisSun);
  const lw = computeWeekMetrics(lastMon, lastSun);

  period.textContent = `${formatDate(thisMon)}–${formatDate(thisSun)} vs ${formatDate(lastMon)}–${formatDate(lastSun)}`;

  const thisRate = tw.applied ? (tw.interviews / tw.applied) : 0;
  const lastRate = lw.applied ? (lw.interviews / lw.applied) : 0;

  const cards = [
    {
      title: 'Applications',
      thisLabel: 'This week',
      lastLabel: 'Last week',
      thisVal: tw.applied,
      lastVal: lw.applied,
      fmt: (x)=>`${x}`,
      delta: tw.applied - lw.applied
    },
    {
      title: 'Interview Rate',
      thisLabel: 'This week',
      lastLabel: 'Last week',
      thisVal: thisRate,
      lastVal: lastRate,
      fmt: (x)=>`${(x*100).toFixed(1)}%`,
      delta: (thisRate - lastRate) * 100
    },
    {
      title: 'Time Invested (Focus)',
      thisLabel: 'This week',
      lastLabel: 'Last week',
      thisVal: tw.focusMs,
      lastVal: lw.focusMs,
      fmt: (x)=>humanMs(x),
      delta: tw.focusMs - lw.focusMs
    }
  ];

  grid.innerHTML = cards.map(c=>{
    const up = c.delta > 0;
    const down = c.delta < 0;
    const deltaClass = up ? 'up' : (down ? 'down' : '');
    const deltaText = (c.title === 'Interview Rate')
      ? `${up?'+':''}${c.delta.toFixed(1)}pp`
      : (c.title === 'Time Invested (Focus)')
        ? `${up?'+':''}${humanMs(Math.abs(c.delta))}`
        : `${up?'+':''}${c.delta}`;

    return `
      <div class="compare-card">
        <div class="compare-title">
          <span>${escapeHtml(c.title)}</span>
          <span class="compare-delta ${deltaClass}">${(up||down) ? deltaText : '—'}</span>
        </div>
        <div class="compare-rows">
          <div class="compare-row"><span>${escapeHtml(c.thisLabel)}</span><b>${escapeHtml(c.fmt(c.thisVal))}</b></div>
          <div class="compare-row"><span>${escapeHtml(c.lastLabel)}</span><b>${escapeHtml(c.fmt(c.lastVal))}</b></div>
        </div>
      </div>
    `;
  }).join('');

  panel.style.display = 'block';
}

function renderStats() {
  const total = db.apps.length;

  const interviewEver = db.apps.filter(a => hasInterview(a)).length;
  const offerEver = db.apps.filter(a => hasOffer(a)).length;

  document.getElementById('stat-applied').innerText = total;
  document.getElementById('stat-interview').innerText = interviewEver;
  document.getElementById('stat-offer').innerText = offerEver;

  const conv = total ? (interviewEver / total) : 0;
  document.getElementById('stat-conv').innerText = (conv * 100).toFixed(1) + '%';

  const today = new Date();
  const currentDay = today.getDay();
  const distanceToMonday = (currentDay + 6) % 7;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - distanceToMonday);
  thisMonday.setHours(0, 0, 0, 0);

  const recentApps = db.apps.filter(a => {
    const dateToCheck = a.appliedDate || a.date;
    if (!dateToCheck) return false;
    const parts = dateToCheck.split('-');
    const appDate = new Date(parts[0], parts[1] - 1, parts[2]);
    return appDate >= thisMonday;
  }).length;

  let target = db.config.weeklyGoal || 10;
  const statWeekEl = document.getElementById('stat-week');
  statWeekEl.innerHTML = `${recentApps}/${target} <span class="edit-icon">✏️</span>`;
  statWeekEl.onclick = editWeeklyGoal;

  document.getElementById('stat-bar').style.width = Math.min((recentApps / target) * 100, 100) + '%';
  document.getElementById('stat-bar').style.backgroundColor = (recentApps >= target) ? 'var(--success)' : 'var(--primary)';
}

function editWeeklyGoal() {
  const current = db.config.weeklyGoal || 10;
  const input = prompt("Set Weekly Goal (Mon-Sun):", current);
  if (input && !isNaN(input)) {
    db.config.weeklyGoal = parseInt(input);
    save();
  }
}

function renderWeeklyInsight(){
  const panel = document.getElementById('insight-panel');
  const textEl = document.getElementById('insight-text');
  if(!panel || !textEl) return;

  const today = new Date();
  const currentDay = today.getDay();
  const distanceToMonday = (currentDay + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - distanceToMonday);
  monday.setHours(0,0,0,0);

  const thisWeekApps = db.apps.filter(a=>{
    const d = a.appliedDate || a.date;
    if(!d) return false;
    const [y,m,dd] = d.split('-').map(Number);
    const dt = new Date(y,m-1,dd);
    return dt >= monday;
  });

  const applied = thisWeekApps.length;
  const interviews = thisWeekApps.filter(a=>hasInterview(a)).length;
  const rate = applied ? interviews / applied : 0;

  let insight = 'Keep a steady cadence and review your pipeline daily.';
  if(applied < 5 && rate >= 0.25) insight = '面试率高但投递偏少 → 建议本周加倍投递量。';
  else if(applied >= 10 && rate < 0.1) insight = '投递多但面试率低 → 需要优化简历或更精准的岗位匹配。';
  else if(applied >= 8 && rate >= 0.2) insight = '当前状态良好：保持节奏 + 做精细化跟进。';
  else if(applied < 5 && rate < 0.1) insight = '投递与面试率都低 → 先集中优化简历与目标岗位。';

  panel.style.display = 'block';
  textEl.textContent = `This Week: Applied ${applied}, Interview rate ${(rate*100).toFixed(1)}%. ${insight}`;
}

function renderPriorityPanel(){
  const panel = document.getElementById('priority-panel');
  const listEl = document.getElementById('priority-list');
  const countEl = document.getElementById('priority-count');
  if(!panel || !listEl || !countEl) return;

  const items = [];

  const overdue = db.apps
    .filter(a => a.status === 'Applied' && !a.remindersDone?.followup14)
    .map(a => ({ app: a, days: daysSinceDateOnly(a.appliedDate || a.date) }))
    .filter(x => x.days > 14)
    .sort((a,b)=>b.days - a.days)[0];

  if(overdue){
    items.push({
      title: `Follow-up overdue: ${overdue.app.company}`,
      subtitle: `${overdue.app.role} • ${overdue.days} days since applied`,
      appId: overdue.app.id
    });
  }

  const today = new Date();
  today.setHours(0,0,0,0);
  const upcoming = db.apps
    .filter(a => (a.status === 'Interview' || a.status === 'Offer') && a.date)
    .map(a => {
      const [y,m,d] = a.date.split('-').map(Number);
      const dt = new Date(y,m-1,d);
      const diff = Math.ceil((dt - today) / (1000*60*60*24));
      return { app: a, diff };
    })
    .filter(x => x.diff >= 0 && x.diff <= 3)
    .sort((a,b)=>a.diff - b.diff)[0];

  if(upcoming){
    items.push({
      title: `Upcoming interview: ${upcoming.app.company}`,
      subtitle: `${upcoming.app.role} • In ${upcoming.diff} day(s)`,
      appId: upcoming.app.id
    });
  }

  const highValue = db.apps
    .filter(a => a.status !== 'Reject')
    .map(a => {
      const tags = (a.tags || []).map(t=>t.toLowerCase());
      const isTarget = tags.some(t => ['dream','target','faang','maang','big','top'].includes(t));
      const isBigCompany = VALUE_COMPANIES.some(c => (a.company || '').toLowerCase().includes(c.toLowerCase()));
      const stageScore = a.status === 'Offer' ? 3 : a.status === 'Interview' ? 2 : a.status === 'Screen' ? 1 : 0;
      const score = stageScore + (isTarget || isBigCompany ? 2 : 0);
      return { app: a, score };
    })
    .sort((a,b)=>b.score - a.score)[0];

  if(highValue){
    items.push({
      title: `High-value pipeline: ${highValue.app.company}`,
      subtitle: `${highValue.app.role} • Status: ${highValue.app.status}`,
      appId: highValue.app.id
    });
  }

  listEl.innerHTML = items.map(i => `
    <div class="reminder-item">
      <div style="flex:1">
        <div class="reminder-title">${escapeHtml(i.title)}</div>
        <div class="reminder-sub">${escapeHtml(i.subtitle)}</div>
      </div>
      <div>
        <button class="mini-btn" onclick="openAppModal('${escapeAttr(i.appId)}')">Open</button>
      </div>
    </div>
  `).join('') || `<div class="small-note">No priority items right now.</div>`;

  countEl.textContent = `${items.length} items`;
  panel.style.display = 'block';
}

function renderBoard(filter = '') {
  const cols = ['Applied', 'Screen', 'Interview', 'Offer', 'Reject'];
  cols.forEach(c => {
    document.getElementById(`col-${c}`).innerHTML = '';
    document.getElementById(`c-${c}`).innerText = 0;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const f = (filter || '').trim().toLowerCase();

  db.apps
    .filter(a => {
      if (!f) return true;
      const tagsStr = (a.tags || []).join(',').toLowerCase();
      const rr = (a.rejectReason || '').toLowerCase();
      const rs = (a.rejectStage || '').toLowerCase();
      const src = (a.source || '').toLowerCase();
      const trk = (a.track || '').toLowerCase();
      return (
        (a.company || '').toLowerCase().includes(f) ||
        (a.role || '').toLowerCase().includes(f) ||
        tagsStr.includes(f) ||
        rr.includes(f) ||
        rs.includes(f) ||
        src.includes(f) ||
        trk.includes(f)
      );
    })
    .forEach(app => {
      ensureMilestones(app);
      const card = document.createElement('div');

      const parts = (app.date || new Date().toISOString().split('T')[0]).split('-');
      const actionDate = new Date(parts[0], parts[1] - 1, parts[2]);
      const diffTime = actionDate - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const appliedStr = app.appliedDate || app.date;
      const appliedParts = appliedStr.split('-');
      const appliedDateObj = new Date(appliedParts[0], appliedParts[1] - 1, appliedParts[2]);
      const appliedDiff = Math.ceil((appliedDateObj - today) / (1000 * 60 * 60 * 24));
      const pastAppliedDays = -appliedDiff;

      let isUrgent = (app.status === 'Interview' && diffDays >= 0 && diffDays <= 3);
      let isGhost = (app.status === 'Applied' && pastAppliedDays > 14);

      let cardClass = `k-card`;
      if (isUrgent) cardClass += ` urgent`;
      if (isGhost) cardClass += ` ghosted`;
      if (app.status === 'Reject') cardClass += ` rejected`;

      card.className = cardClass;
      card.draggable = true;

      let isDragging = false;
      card.ondragstart = (e) => {
        isDragging = true;
        e.dataTransfer.setData('text/plain', app.id);
        try { e.dataTransfer.effectAllowed = 'move'; } catch(_) {}
      };
      card.ondragend = () => { setTimeout(() => { isDragging = false; }, 50); };

      card.onclick = (e) => {
        if (isDragging) return;
        if (!e.target.classList.contains('kc-link')) openAppModal(app.id);
      };

      let extraHtml = '';
      if (isUrgent) {
        const dayLabel = diffDays === 0 ? 'TODAY!' : (diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`);
        extraHtml = `<div class="urgent-badge">⏰ ${dayLabel}</div>`;
      }

      let footerHtml = '';
      if (isGhost) {
        footerHtml = `<div class="follow-up-hint">⚠️ Should follow up? (+14d)</div>`;
      } else {
        footerHtml = app.link ? `<a href="${escapeAttr(app.link)}" target="_blank" class="kc-link">🔗 Link</a>` : '<span></span>';
      }

      let dateText = '';
      if (diffDays > 0) dateText = `📅 In ${diffDays} days`;
      else if (diffDays === 0) dateText = `📅 Today`;
      else dateText = `📅 ${-diffDays}d ago`;

      let appliedText = '';
      if (app.appliedDate) {
        const [y, m, d] = app.appliedDate.split('-');
        appliedText = `<div class="kc-applied-date">Applied: ${m}/${d}</div>`;
      }

      const tags = (app.tags || []).slice(0, 4);
      const tagsHtml = tags.length ? tags.map(t => `<span class="pill">${escapeHtml(t)}</span>`).join('') : '';
      const moreTags = (app.tags || []).length > 4 ? `<span class="pill muted">+${(app.tags.length - 4)} more</span>` : '';

      const trackText = (app.track === "B-Product") ? "B Product" : "A Data";
      const sourceText = app.source || "Company Site";

      const rrHtml = (app.status === 'Reject' && app.rejectReason)
        ? `<div class="pill-row"><span class="pill muted">❌ ${escapeHtml(app.rejectReason)}</span></div>`
        : '';

      const rsHtml = (app.status === 'Reject' && app.rejectStage)
        ? `<span class="pill muted">🚫 After: ${escapeHtml(app.rejectStage)}</span>`
        : '';

      const msBadges = `
        ${hasScreen(app) ? `<span class="pill muted">✅ Screen</span>` : ``}
        ${hasInterview(app) ? `<span class="pill muted">✅ Interview</span>` : ``}
        ${hasOffer(app) ? `<span class="pill muted">✅ Offer</span>` : ``}
      `;

      card.innerHTML = `
        ${extraHtml}
        <div class="kc-title">${escapeHtml(app.company)}</div>
        <div class="kc-role">${escapeHtml(app.role)}</div>
        ${app.nextStep ? `<div class="kc-next">📌 ${escapeHtml(app.nextStep)}</div>` : ''}
        <div class="pill-row">
          ${app.status === 'Reject' ? `<span class="pill muted">❌ Rejected</span>` : ``}
          <span class="pill muted">🧾 Resume: ${escapeHtml(app.resumeVersion || 'Other')}</span>
          <span class="pill muted">🎯 ${escapeHtml(trackText)}</span>
          <span class="pill muted">📮 ${escapeHtml(sourceText)}</span>
          ${rsHtml}
          ${tagsHtml}
          ${moreTags}
        </div>
        <div class="pill-row" style="margin-top:6px">${msBadges}</div>
        ${rrHtml}
        <div class="kc-footer" style="margin-top:10px">
          <div class="kc-date-group">
            <div class="kc-date" style="${isUrgent ? 'color:#ef4444;font-weight:bold' : ''}">${dateText}</div>
            ${appliedText}
          </div>
          ${footerHtml}
        </div>
      `;

      const status = boardColumnStatus(app);
      document.getElementById(`col-${status}`).appendChild(card);
      document.getElementById(`c-${status}`).innerText = parseInt(document.getElementById(`c-${status}`).innerText) + 1;
    });
}

function filterBoard(val) { renderBoard(val); }

function magicPaste() {
  const val = document.getElementById('magic-input').value;
  if (!val) return;

  let parts = val.split(' ');
  let co = parts[0];
  let role = parts.slice(1).join(' ') || "Analyst";
  if (val.includes(' at ')) {
    let s = val.split(' at ');
    role = s[0];
    co = s[1];
  }
  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const newApp = {
    id: Date.now().toString(),
    company: co.replace('applied', '').trim(),
    role: role.trim(),
    date: today,
    appliedDate: today,
    status: 'Applied',
    nextStep: '',
    link: '',
    desc: '',
    resumeVersion: 'Other',
    tags: [],
    rejectReason: '',
    track: 'A-Data',
    source: 'Company Site',
    remindersDone: {},
    rejectStage: '',
    milestones: { screenAt: null, interviewAt: null, offerAt: null },
    statusUpdatedAt: now,
    rejectedAt: null,
    interviewResult: 'pending'
  };

  db.apps.unshift(newApp);
  save();
  renderBoard(currentFilterValue());
  document.getElementById('magic-input').value = '';
}

function currentFilterValue(){
  return document.getElementById('filter-input')?.value || '';
}

function renderReminders(){
  const panel = document.getElementById('reminder-panel');
  const list = document.getElementById('reminder-list');
  const countEl = document.getElementById('reminder-count');

  const tasks = generateReminderTasks();
  if(tasks.length === 0){
    panel.style.display = 'none';
    list.innerHTML = '';
    countEl.textContent = '0';
    return;
  }

  panel.style.display = 'block';
  countEl.textContent = `${tasks.length} pending`;

  list.innerHTML = tasks.map(t => `
    <div class="reminder-item">
      <div style="flex:1">
        <div class="reminder-title">${escapeHtml(t.title)}</div>
        <div class="reminder-sub">${escapeHtml(t.subtitle)}</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-shrink:0">
        <button class="mini-btn" onclick="copyTemplate('${escapeAttr(t.appId)}','${escapeAttr(t.type)}')">Copy</button>
        <button class="mini-btn" onclick="openAppModal('${escapeAttr(t.appId)}')">Open</button>
        <button class="mini-btn danger" onclick="markReminderDone('${escapeAttr(t.appId)}','${escapeAttr(t.type)}')">Done</button>
      </div>
    </div>
  `).join('');
}

function generateReminderTasks(){
  const tasks = [];
  db.apps.forEach(app => {
    if(!app.remindersDone) app.remindersDone = {};
    if(!app.statusUpdatedAt) app.statusUpdatedAt = (app.date ? dateOnlyToISO(app.date) : new Date().toISOString());

    if(app.status === 'Applied' && !app.remindersDone.followup14){
      const days = daysSinceDateOnly(app.appliedDate);
      if(days > 14){
        tasks.push({
          appId: app.id,
          type: 'followup14',
          title: `📨 Follow-up: ${app.company}`,
          subtitle: `${app.role} • Applied ${days} days ago`
        });
      }
    }

    if(app.status === 'Interview' && !app.remindersDone.thankyou24){
      if(hoursSinceISO(app.statusUpdatedAt) > 24){
        tasks.push({
          appId: app.id,
          type: 'thankyou24',
          title: `🙏 Thank-you Email: ${app.company}`,
          subtitle: `${app.role} • Interview stage >24h`
        });
      }
    }

    if(app.status === 'Offer' && !app.remindersDone.offer48){
      if(hoursSinceISO(app.statusUpdatedAt) > 48){
        tasks.push({
          appId: app.id,
          type: 'offer48',
          title: `💬 Offer Follow-up: ${app.company}`,
          subtitle: `${app.role} • Offer stage >48h`
        });
      }
    }
  });

  const priority = { offer48: 0, thankyou24: 1, followup14: 2 };
  tasks.sort((a,b) => (priority[a.type] ?? 9) - (priority[b.type] ?? 9));
  return tasks;
}

function markReminderDone(appId, type){
  const app = db.apps.find(a => a.id === appId);
  if(!app) return;
  if(!app.remindersDone) app.remindersDone = {};
  app.remindersDone[type] = true;
  save();
  renderReminders();
}

function copyTemplate(appId, type){
  const app = db.apps.find(a => a.id === appId);
  if(!app) return;

  let text = '';
  if(type === 'followup14') text = buildFollowUpEmail(app);
  if(type === 'thankyou24') text = buildThankYouEmail(app);
  if(type === 'offer48') text = buildOfferEmail(app);

  navigator.clipboard.writeText(text).then(()=>alert('Copied ✅')).catch(()=>prompt('Copy:', text));
}

function buildFollowUpEmail(app){
  return `Subject: Follow-up on ${app.role} application

Hi Hiring Team,

I hope you’re doing well. I wanted to follow up on my application for the ${app.role} role at ${app.company}. I remain very interested in the opportunity and would love to share any additional information if helpful.

If there are any updates on the hiring timeline or next steps, I’d really appreciate it.

Thank you for your time and consideration.
Best regards,
Lucy`;
}

function buildThankYouEmail(app){
  return `Subject: Thank you — ${app.role} interview

Hi [Interviewer Name],

Thank you again for taking the time to speak with me about the ${app.role} opportunity at ${app.company}. I enjoyed learning more about the team and the work, and I’m even more excited about the possibility of contributing.

If helpful, I’m happy to provide any additional details.

Best,
Lucy`;
}

function buildOfferEmail(app){
  return `Subject: Offer details & next steps — ${app.role}

Hi [Recruiter Name],

Thank you again for the offer for the ${app.role} position at ${app.company}. I’m excited about the opportunity.

Could you please share the decision deadline / timeline for the offer? Also, I’d appreciate any additional details on compensation & benefits, and whether there is flexibility to discuss the package.

Thank you!
Best,
Lucy`;
}

function parseKeywordsBank(str){
  return (str || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .map(x => (x === 'ab test' || x === 'ab testing') ? 'a/b test' : x);
}

function extractKeywordsFromText(text){
  const s = (text || '').toLowerCase();
  const found = new Set();

  KEYWORD_LIBRARY.forEach(k => {
    const kk = k.toLowerCase();
    if(kk.length <= 3){
      const re = new RegExp(`\\b${escapeRegex(kk)}\\b`, 'i');
      if(re.test(s)) found.add(normalizeKeyword(kk));
    } else {
      if(s.includes(kk)) found.add(normalizeKeyword(kk));
    }
  });

  if(found.has('ab test') || found.has('ab testing')) found.add('a/b test');
  found.delete('ab test'); found.delete('ab testing');
  return found;
}

function normalizeKeyword(k){ return k.trim(); }

function updateJDMatchUI(jdText){
  const scoreEl = document.getElementById('jd-match-score');
  const barEl = document.getElementById('jd-match-bar');
  const missTextEl = document.getElementById('jd-missing-text');
  const missTagsEl = document.getElementById('jd-missing-tags');

  const t = (jdText || '').trim();
  if(t.length < 20){
    scoreEl.textContent = '0%';
    barEl.style.width = '0%';
    barEl.style.background = 'var(--primary)';
    missTextEl.textContent = 'Paste JD to see missing keywords.';
    missTagsEl.innerHTML = '';
    return;
  }

  const resumeBank = new Set(parseKeywordsBank(db.config.resumeKeywords || ''));
  if(resumeBank.size === 0){
    scoreEl.textContent = '—';
    barEl.style.width = '0%';
    barEl.style.background = 'var(--primary)';
    missTextEl.textContent = 'Set your Resume Keyword Bank in Data → then this will show missing keywords.';
    missTagsEl.innerHTML = '';
    return;
  }

  const jdKw = Array.from(extractKeywordsFromText(t));
  if(jdKw.length === 0){
    scoreEl.textContent = '0%';
    barEl.style.width = '0%';
    missTextEl.textContent = 'No recognizable keywords found (simple library).';
    missTagsEl.innerHTML = '';
    return;
  }

  const missing = jdKw.filter(k => !resumeBank.has(k));
  const matched = jdKw.length - missing.length;
  const score = Math.round((matched / jdKw.length) * 100);

  scoreEl.textContent = `${score}%`;
  barEl.style.width = `${Math.min(score,100)}%`;
  barEl.style.background = (score >= 70) ? 'var(--success)' : 'var(--primary)';

  if(missing.length === 0){
    missTextEl.textContent = 'Nice — no missing keywords found (from library).';
    missTagsEl.innerHTML = '';
    return;
  }

  missTextEl.textContent = 'Missing keywords vs your Resume Keyword Bank:';
  missTagsEl.innerHTML = missing.slice(0, 24).map(k => `<span class="missing-tag">${escapeHtml(k)}</span>`).join('')
    + (missing.length > 24 ? `<span class="missing-tag">+${missing.length-24} more</span>` : '');
}

function attachJDListenerOnce(){
  const el = document.getElementById('app-desc');
  if(!el || el.dataset.listener === '1') return;
  el.dataset.listener = '1';
  el.addEventListener('input', (e) => updateJDMatchUI(e.target.value));
}

function renderInterviewFunnel(){
  const div = document.getElementById('funnel-metrics');
  if(!div) return;

  const applied = db.apps.length;
  const screen = db.apps.filter(a => hasScreen(a)).length;
  const interview = db.apps.filter(a => hasInterview(a)).length;
  const offer = db.apps.filter(a => hasOffer(a)).length;

  const rateScreen = applied ? (screen/applied)*100 : 0;
  const rateInterview = screen ? (interview/screen)*100 : 0;
  const rateOffer = interview ? (offer/interview)*100 : 0;

  const avgScreenToInterview = avgDaysBetweenMilestones('screenAt','interviewAt');
  const avgInterviewToOffer = avgDaysBetweenMilestones('interviewAt','offerAt');

  div.innerHTML = `
    <table class="simple-table">
      <thead><tr><th>Stage</th><th>Count</th><th>Conversion</th><th>Avg Days</th></tr></thead>
      <tbody>
        <tr><td>Applied → Screen</td><td>${screen}</td><td>${rateScreen.toFixed(1)}%</td><td>—</td></tr>
        <tr><td>Screen → Interview</td><td>${interview}</td><td>${rateInterview.toFixed(1)}%</td><td>${fmtNumber(avgScreenToInterview)}</td></tr>
        <tr><td>Interview → Offer</td><td>${offer}</td><td>${rateOffer.toFixed(1)}%</td><td>${fmtNumber(avgInterviewToOffer)}</td></tr>
      </tbody>
    </table>
  `;
}

function avgDaysBetweenMilestones(aField, bField){
  const values = [];
  db.apps.forEach(app=>{
    ensureMilestones(app);
    const a = app.milestones[aField];
    const b = app.milestones[bField];
    if(a && b){
      const d = (new Date(b) - new Date(a)) / (1000*60*60*24);
      if(isFinite(d) && d >= 0) values.push(d);
    }
  });
  return values.length ? values.reduce((x,y)=>x+y,0)/values.length : null;
}

function renderPipelineHealth(){
  const div = document.getElementById('pipeline-health');
  if(!div) return;

  const avgToScreen = avgDaysToMilestone('screenAt');
  const avgToInterview = avgDaysToMilestone('interviewAt');
  const avgToOffer = avgDaysToMilestone('offerAt');
  const avgToReject = avgDaysToReject();

  const snapshot = countByStatus();
  const bottleneck = computeBottleneck();

  div.innerHTML = `
    <table class="simple-table">
      <thead>
        <tr><th>Metric</th><th>Value</th><th>Notes</th></tr>
      </thead>
      <tbody>
        <tr><td><b>Avg days → Screen/OA</b></td><td><b>${fmtNumber(avgToScreen)}</b></td><td>Applied → first Screen milestone</td></tr>
        <tr><td><b>Avg days → Interview</b></td><td><b>${fmtNumber(avgToInterview)}</b></td><td>Applied → first Interview milestone (Offer includes Interview)</td></tr>
        <tr><td><b>Avg days → Offer</b></td><td><b>${fmtNumber(avgToOffer)}</b></td><td>Applied → first Offer milestone</td></tr>
        <tr><td><b>Avg days → Reject</b></td><td><b>${fmtNumber(avgToReject)}</b></td><td>Applied → rejectedAt</td></tr>
        <tr><td><b>Pipeline snapshot</b></td><td><b>${snapshot}</b></td><td>Applied/Screen/Interview/Offer/Reject (current)</td></tr>
        <tr><td><b>Most stuck stage now</b></td><td><b>${escapeHtml(bottleneck.stage)}</b></td><td>${escapeHtml(bottleneck.note)}</td></tr>
      </tbody>
    </table>
  `;
}

function avgDaysToMilestone(field){
  const values = [];
  db.apps.forEach(app => {
    ensureMilestones(app);
    const appliedTs = dateOnlyToISO(app.appliedDate || app.date);
    let targetTs = app.milestones[field] || null;

    if(field === 'interviewAt' && !targetTs && app.milestones.offerAt){
      targetTs = app.milestones.offerAt;
    }

    if(appliedTs && targetTs){
      const d = (new Date(targetTs) - new Date(appliedTs)) / (1000*60*60*24);
      if(isFinite(d) && d >= 0) values.push(d);
    }
  });
  return values.length ? (values.reduce((a,b)=>a+b,0)/values.length) : null;
}

function avgDaysToReject(){
  const values = [];
  db.apps.forEach(app => {
    if(app.status !== 'Reject' && !app.rejectedAt) return;
    const appliedTs = dateOnlyToISO(app.appliedDate || app.date);
    const targetTs = app.rejectedAt || dateOnlyToISO(app.date);
    if(appliedTs && targetTs){
      const d = (new Date(targetTs) - new Date(appliedTs)) / (1000*60*60*24);
      if(isFinite(d) && d >= 0) values.push(d);
    }
  });
  return values.length ? (values.reduce((a,b)=>a+b,0)/values.length) : null;
}

function countByStatus(){
  const order = ['Applied','Screen','Interview','Offer','Reject'];
  const c = {};
  order.forEach(s => c[s] = 0);
  db.apps.forEach(a => { c[a.status] = (c[a.status] || 0) + 1; });
  return `${c.Applied||0}/${c.Screen||0}/${c.Interview||0}/${c.Offer||0}/${c.Reject||0}`;
}

function computeBottleneck(){
  const stages = ['Applied','Screen','Interview'];
  const now = new Date();
  const bucket = {};
  stages.forEach(s => bucket[s] = []);

  db.apps.forEach(app => {
    if(!stages.includes(app.status)) return;
    const ts = app.statusUpdatedAt || (app.date ? dateOnlyToISO(app.date) : null);
    if(!ts) return;
    const days = (now - new Date(ts)) / (1000*60*60*24);
    if(isFinite(days) && days >= 0) bucket[app.status].push(days);
  });

  let best = { stage: '—', days: -1, note: 'Not enough data.' };
  stages.forEach(s => {
    if(bucket[s].length === 0) return;
    const avg = bucket[s].reduce((a,b)=>a+b,0)/bucket[s].length;
    if(avg > best.days){
      best = { stage: s, days: avg, note: `Avg ${avg.toFixed(1)} days in stage (ongoing apps).` };
    }
  });
  return best;
}

function renderSourcePerformance(){
  const div = document.getElementById('source-performance');
  if(!div) return;

  const buckets = {};
  db.apps.forEach(app => {
    const s = app.source || 'Other';
    if(!buckets[s]) buckets[s] = { applied:0, interviewStage:0, offers:0 };
    buckets[s].applied += 1;
    if(hasInterview(app)) buckets[s].interviewStage += 1;
    if(hasOffer(app)) buckets[s].offers += 1;
  });

  const rows = Object.entries(buckets)
    .sort((a,b)=>b[1].applied - a[1].applied)
    .map(([src,v])=>{
      const rate = v.applied ? (v.interviewStage / v.applied) * 100 : 0;
      return `
        <tr>
          <td><b>${escapeHtml(src)}</b></td>
          <td>${v.applied}</td>
          <td>${v.interviewStage}</td>
          <td>${v.offers}</td>
          <td><b>${rate.toFixed(1)}%</b></td>
        </tr>
      `;
    }).join('');

  div.innerHTML = `
    <table class="simple-table">
      <thead>
        <tr><th>Source</th><th>Applied</th><th>Interview (Ever)</th><th>Offers (Ever)</th><th>Interview rate</th></tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="5" style="color:var(--text-sub); font-weight:700;">No data yet.</td></tr>`}
      </tbody>
    </table>
  `;
}

function syncRejectUI(){
  const st = document.getElementById('app-status')?.value || 'Applied';
  const grpStage = document.getElementById('grp-reject-stage');
  const grpReason = document.getElementById('grp-reject-reason');
  const grpInterview = document.getElementById('grp-interview-result');

  const showReject = (st === 'Reject');
  grpStage.classList.toggle('cond-hidden', !showReject);
  grpReason.classList.toggle('cond-hidden', !showReject);

  const showInterview = (st === 'Interview');
  grpInterview.classList.toggle('cond-hidden', !showInterview);
}

function isoToDateOnly(iso){
  if(!iso) return '';
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = pad2(d.getMonth()+1);
  const dd = pad2(d.getDate());
  return `${y}-${m}-${dd}`;
}

function isoToLocalDateStr(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function isoToLocalTimeStr(iso){
  if(!iso) return '';
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function syncMilestoneInputs(){
  const pairs = [
    ['ms-screen-cb','ms-screen-date'],
    ['ms-interview-cb','ms-interview-date'],
    ['ms-offer-cb','ms-offer-date'],
  ];
  pairs.forEach(([cbId, dateId])=>{
    const cb = document.getElementById(cbId);
    const dt = document.getElementById(dateId);
    if(!cb || !dt) return;
    dt.disabled = !cb.checked;
    dt.style.opacity = cb.checked ? '1' : '0.55';
  });
}

function openAppModal(id = null) {
  document.getElementById('modal-app').style.display = 'flex';
  const today = new Date().toISOString().split('T')[0];

  attachJDListenerOnce();

  if (id) {
    const app = db.apps.find(a => a.id === id);
    ensureMilestones(app);

    document.getElementById('app-id').value = id;
    document.getElementById('app-co').value = app.company || '';
    document.getElementById('app-role').value = app.role || '';
    document.getElementById('app-status').value = app.status || 'Applied';

    document.getElementById('app-track').value = app.track || 'A-Data';
    document.getElementById('app-source').value = app.source || 'Company Site';
    document.getElementById('app-resume').value = app.resumeVersion || 'Other';

    document.getElementById('app-date').value = app.date || today;
    document.getElementById('app-applied-date').value = app.appliedDate || app.date || today;

    document.getElementById('app-link').value = app.link || '';
    document.getElementById('app-next').value = app.nextStep || '';
    document.getElementById('app-desc').value = app.desc || '';

    document.getElementById('app-tags').value = (app.tags || []).join(', ');
    document.getElementById('app-reject-reason').value = app.rejectReason || '';
    document.getElementById('app-reject-stage').value = app.rejectStage || '';

    document.getElementById('app-interview-result').value = app.interviewResult || 'pending';

    document.getElementById('ms-screen-cb').checked = !!app.milestones?.screenAt;
    document.getElementById('ms-interview-cb').checked = !!app.milestones?.interviewAt;
    document.getElementById('ms-offer-cb').checked = !!app.milestones?.offerAt;

    document.getElementById('ms-screen-date').value = isoToDateOnly(app.milestones?.screenAt) || today;
    document.getElementById('ms-interview-date').value = isoToDateOnly(app.milestones?.interviewAt) || today;
    document.getElementById('ms-offer-date').value = isoToDateOnly(app.milestones?.offerAt) || today;

    syncMilestoneInputs();

    updateJDMatchUI(app.desc || '');
    document.getElementById('app-modal-title').innerText = 'Edit Application';
  } else {
    document.getElementById('app-id').value = '';
    document.getElementById('app-co').value = '';
    document.getElementById('app-role').value = '';
    document.getElementById('app-status').value = 'Applied';

    document.getElementById('app-track').value = 'A-Data';
    document.getElementById('app-source').value = 'Company Site';
    document.getElementById('app-resume').value = 'Other';

    document.getElementById('app-date').value = today;
    document.getElementById('app-applied-date').value = today;

    document.getElementById('app-link').value = '';
    document.getElementById('app-next').value = '';
    document.getElementById('app-desc').value = '';

    document.getElementById('app-tags').value = '';
    document.getElementById('app-reject-reason').value = '';
    document.getElementById('app-reject-stage').value = '';

    document.getElementById('app-interview-result').value = 'pending';

    document.getElementById('ms-screen-cb').checked = false;
    document.getElementById('ms-interview-cb').checked = false;
    document.getElementById('ms-offer-cb').checked = false;

    document.getElementById('ms-screen-date').value = today;
    document.getElementById('ms-interview-date').value = today;
    document.getElementById('ms-offer-date').value = today;

    syncMilestoneInputs();

    updateJDMatchUI('');
    document.getElementById('app-modal-title').innerText = 'New Application';
  }

  syncRejectUI();
}

function saveApp() {
  const id = document.getElementById('app-id').value;
  const tags = parseTags(document.getElementById('app-tags').value);
  const newStatus = document.getElementById('app-status').value;

  const interviewResult = document.getElementById('app-interview-result')?.value || 'pending';

  const msScreenOn = document.getElementById('ms-screen-cb')?.checked;
  const msInterviewOn = document.getElementById('ms-interview-cb')?.checked;
  const msOfferOn = document.getElementById('ms-offer-cb')?.checked;

  const msScreenDate = document.getElementById('ms-screen-date')?.value;
  const msInterviewDate = document.getElementById('ms-interview-date')?.value;
  const msOfferDate = document.getElementById('ms-offer-date')?.value;

  if (id) {
    const idx = db.apps.findIndex(a => a.id === id);
    const old = db.apps[idx];
    const oldStatus = old.status;

    old.company = document.getElementById('app-co').value;
    old.role = document.getElementById('app-role').value;

    old.track = document.getElementById('app-track').value || old.track || 'A-Data';
    old.source = document.getElementById('app-source').value || old.source || 'Company Site';
    old.resumeVersion = document.getElementById('app-resume').value || old.resumeVersion || 'Other';

    old.date = document.getElementById('app-date').value;
    old.appliedDate = document.getElementById('app-applied-date').value;

    old.link = document.getElementById('app-link').value;
    old.nextStep = document.getElementById('app-next').value;
    old.desc = document.getElementById('app-desc').value;

    old.tags = tags;
    old.rejectReason = document.getElementById('app-reject-reason').value || '';
    old.rejectStage = document.getElementById('app-reject-stage').value || '';

    ensureMilestones(old);

    const effectiveStatus = newStatus;
    const mustScreen = (effectiveStatus === 'Screen');
    const mustInterview = (effectiveStatus === 'Interview' || effectiveStatus === 'Offer');
    const mustOffer = (effectiveStatus === 'Offer');

    const finalScreenOn = !!(msScreenOn || mustScreen);
    const finalInterviewOn = !!(msInterviewOn || mustInterview);
    const finalOfferOn = !!(msOfferOn || mustOffer);

    old.milestones.screenAt = finalScreenOn ? dateOnlyToISO(msScreenDate || old.appliedDate || old.date) : null;
    old.milestones.interviewAt = finalInterviewOn ? dateOnlyToISO(msInterviewDate || old.appliedDate || old.date) : null;
    old.milestones.offerAt = finalOfferOn ? dateOnlyToISO(msOfferDate || old.appliedDate || old.date) : null;

    if(old.milestones.offerAt && !old.milestones.interviewAt){
      old.milestones.interviewAt = old.milestones.offerAt;
    }

    old.interviewResult = interviewResult;

    let finalStatus = newStatus;
    if(newStatus === 'Interview' && interviewResult === 'fail'){
      finalStatus = 'Reject';
      old.rejectStage = 'Interview';
    }

    if(finalStatus !== oldStatus){
      old.status = finalStatus;
      onStatusChange(old, oldStatus, finalStatus);
    } else {
      if(finalStatus === 'Reject'){
        normalizeRejectStage(old);
      }
    }

    if(old.status === 'Reject') normalizeRejectStage(old);

    db.apps[idx] = old;
  } else {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toISOString();
    const status = newStatus || 'Applied';
    const appliedDate = document.getElementById('app-applied-date').value || today;

    let finalStatus = status;
    let rejectStage = document.getElementById('app-reject-stage').value || '';

    if(status === 'Interview' && interviewResult === 'fail'){
      finalStatus = 'Reject';
      rejectStage = 'Interview';
    }

    const app = {
      id: Date.now().toString(),
      company: document.getElementById('app-co').value,
      role: document.getElementById('app-role').value,
      status: finalStatus,
      date: document.getElementById('app-date').value || today,
      appliedDate: appliedDate,
      link: document.getElementById('app-link').value,
      nextStep: document.getElementById('app-next').value,
      desc: document.getElementById('app-desc').value,
      resumeVersion: document.getElementById('app-resume').value || 'Other',
      tags: tags,
      rejectReason: document.getElementById('app-reject-reason').value || '',
      track: document.getElementById('app-track').value || 'A-Data',
      source: document.getElementById('app-source').value || 'Company Site',
      remindersDone: {},
      rejectStage: rejectStage,
      milestones: { screenAt: null, interviewAt: null, offerAt: null },
      statusUpdatedAt: now,
      rejectedAt: null,
      interviewResult: interviewResult
    };

    ensureMilestones(app);

    const mustScreen = (status === 'Screen');
    const mustInterview = (status === 'Interview' || status === 'Offer');
    const mustOffer = (status === 'Offer');

    const finalScreenOn = !!(msScreenOn || mustScreen);
    const finalInterviewOn = !!(msInterviewOn || mustInterview || (rejectStage === 'Interview'));
    const finalOfferOn = !!(msOfferOn || mustOffer || (rejectStage === 'Offer'));

    app.milestones.screenAt = finalScreenOn ? dateOnlyToISO(msScreenDate || appliedDate) : null;
    app.milestones.interviewAt = finalInterviewOn ? dateOnlyToISO(msInterviewDate || appliedDate) : null;
    app.milestones.offerAt = finalOfferOn ? dateOnlyToISO(msOfferDate || appliedDate) : null;
    if(app.milestones.offerAt && !app.milestones.interviewAt){
      app.milestones.interviewAt = app.milestones.offerAt;
    }

    if(finalStatus === 'Reject'){
      app.rejectedAt = now;
      normalizeRejectStage(app);
    } else {
      if(finalStatus === 'Screen' || finalStatus === 'Interview' || finalStatus === 'Offer'){
        applyMilestone(app, finalStatus, now);
      }
    }

    db.apps.unshift(app);
  }

  save();
  closeModal('modal-app');
  renderBoard(currentFilterValue());
  renderStats();
  renderReminders();
}

function deleteApp() {
  const id = document.getElementById('app-id').value;
  if (id && confirm('Delete?')) {
    db.apps = db.apps.filter(a => a.id !== id);
    save();
    closeModal('modal-app');
    renderBoard(currentFilterValue());
    renderStats();
    renderReminders();
  }
}

function closeModal(mid) { document.getElementById(mid).style.display = 'none'; }

document.querySelectorAll('.board-col').forEach(col => {
  col.ondragover = e => e.preventDefault();
  col.ondrop = e => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const newStatus = col.getAttribute('data-status');
    const app = db.apps.find(a => a.id === id);

    if (app && app.status !== newStatus) {
      const oldStatus = app.status;
      app.status = newStatus;
      onStatusChange(app, oldStatus, newStatus);

      if(newStatus === 'Reject'){
        normalizeRejectStage(app);
      }

      save();
      renderBoard(currentFilterValue());
      renderReminders();
    }
  };
});

function switchView(v, ev) {
  document.querySelectorAll('.view').forEach(e => e.classList.remove('active'));
  document.getElementById(`view-${v}`).classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (ev && ev.target) ev.target.classList.add('active');

  if (v === 'prep') renderPrep();
  if (v === 'networking') renderNet();
  if (v === 'settings') {
    const el = document.getElementById('cfg-resume-keywords');
    if (el) el.value = db.config.resumeKeywords || '';
    renderABSummary();
    renderTrackSummary();
    renderSourcePerformance();
    renderInterviewFunnel();
    renderPipelineHealth();
  }
  if (v === 'board') {
    renderReminders();
  }
  if (v === 'time') {
    renderTimeView();
  }
  if (v === 'ideas') {
    renderIdeas();
  }
}

function toggleTheme() {
  db.config.theme = db.config.theme === 'light' ? 'dark' : 'light';
  applyTheme(db.config.theme);
  save();
}
function applyTheme(t) { document.body.setAttribute('data-theme', t); }

function saveResumeKeywordConfig(){
  const el = document.getElementById('cfg-resume-keywords');
  db.config.resumeKeywords = (el?.value || '').trim();
  save();
  alert('Saved ✅');
}

function exportData() {
  const blob = new Blob([JSON.stringify(db)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'lucy_tracker_backup.json';
  a.click();
}
function importData(input) {
  const r = new FileReader();
  r.onload = e => {
    db = JSON.parse(e.target.result);
    normalizeDb();
    save(true);
    location.reload();
  };
  r.readAsText(input.files[0]);
}
function clearData() {
  if (confirm("This will WIPE all data and reset to defaults. Sure?")) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
}
function googleDriveSync(){
  alert('Google Drive Sync (Beta) is not enabled yet. Use Export/Import for now.');
}

window.addEventListener('beforeunload', function (e) {
  e.preventDefault();
  e.returnValue = '';
});

let _timerUiTick = null;
let _pomoTick = null;
let _timerMode = 'stopwatch';
let _chartType = 'pie';
let _pieGroup = 'activity';
let _chartState = { series: [], labels: [] };
let _sessionFilter = { mode: 'day', day: '', week: '', month: '', year: '', sort: 'time-asc' };

function switchTimerMode(mode){
  _timerMode = mode;
  document.getElementById('mode-stopwatch-btn').classList.toggle('active', mode === 'stopwatch');
  document.getElementById('mode-pomo-btn').classList.toggle('active', mode === 'pomodoro');
  document.getElementById('stopwatch-panel').style.display = (mode === 'stopwatch') ? 'block' : 'none';
  document.getElementById('pomodoro-panel').style.display = (mode === 'pomodoro') ? 'block' : 'none';
}

function setChartType(t){
  _chartType = t;
  document.getElementById('chart-btn-pie').classList.toggle('active', t==='pie');
  document.getElementById('chart-btn-hist').classList.toggle('active', t==='hist');
  document.getElementById('chart-btn-line').classList.toggle('active', t==='line');
  renderTimeCharts();
}

function setPieGroup(g){
  _pieGroup = g;
  document.getElementById('group-activity').classList.toggle('active', g==='activity');
  document.getElementById('group-tag').classList.toggle('active', g==='tag');
  if(_chartType === 'pie') renderTimeCharts();
}

function renderTimeView(){
  renderTimerAppOptions();
  renderTimerSummary();
  initTimeFilters();
  initSessionFilter();
  renderTimeSessions();
  renderTimeCharts();
}

function initTimeFilters(){
  const startEl = document.getElementById('time-start-date');
  const endEl = document.getElementById('time-end-date');
  if(!startEl || !endEl) return;

  if(!startEl.value || !endEl.value){
    const today = new Date();
    const end = new Date(today);
    const start = new Date(today);
    start.setDate(start.getDate() - 6);
    startEl.value = start.toISOString().slice(0,10);
    endEl.value = end.toISOString().slice(0,10);
  }

  startEl.onchange = () => renderTimeCharts();
  endEl.onchange = () => renderTimeCharts();
}

function renderTimerAppOptions(){
  const sel = document.getElementById('timer-app');
  if(!sel) return;

  const opts = [`<option value="">(No app)</option>`].concat(
    (db.apps || []).slice(0, 200).map(a => {
      const label = `${escapeHtml(a.company)} — ${escapeHtml(a.role)}`.slice(0, 80);
      return `<option value="${escapeAttr(a.id)}">${label}</option>`;
    })
  );
  sel.innerHTML = opts.join('');

  const dateEl = document.getElementById('timer-date');
  if(dateEl && !dateEl.value){
    dateEl.value = new Date().toISOString().slice(0,10);
  }
}

function initSessionFilter(){
  const dayEl = document.getElementById('session-day');
  const weekEl = document.getElementById('session-week');
  const monthEl = document.getElementById('session-month');
  const yearEl = document.getElementById('session-year');
  const sortEl = document.getElementById('session-sort');

  const today = new Date();
  if(!_sessionFilter.day) _sessionFilter.day = today.toISOString().slice(0,10);
  if(!_sessionFilter.week) _sessionFilter.week = getWeekInputValue(today);
  if(!_sessionFilter.month) _sessionFilter.month = today.toISOString().slice(0,7);
  if(!_sessionFilter.year) _sessionFilter.year = String(today.getFullYear());
  if(!_sessionFilter.sort) _sessionFilter.sort = 'time-asc';

  if(dayEl) dayEl.value = _sessionFilter.day;
  if(weekEl) weekEl.value = _sessionFilter.week;
  if(monthEl) monthEl.value = _sessionFilter.month;
  if(yearEl) yearEl.value = _sessionFilter.year;
  if(sortEl) sortEl.value = _sessionFilter.sort;

  if(dayEl) dayEl.onchange = () => { _sessionFilter.day = dayEl.value; renderTimeSessions(); };
  if(weekEl) weekEl.onchange = () => { _sessionFilter.week = weekEl.value; renderTimeSessions(); };
  if(monthEl) monthEl.onchange = () => { _sessionFilter.month = monthEl.value; renderTimeSessions(); };
  if(yearEl) yearEl.onchange = () => { _sessionFilter.year = yearEl.value; renderTimeSessions(); };
  if(sortEl) sortEl.onchange = () => { _sessionFilter.sort = sortEl.value; renderTimeSessions(); };

  setSessionFilterMode(_sessionFilter.mode, false);
}

function setSessionFilterMode(mode, rerender = true){
  _sessionFilter.mode = mode;

  document.getElementById('filter-btn-day').classList.toggle('active', mode === 'day');
  document.getElementById('filter-btn-week').classList.toggle('active', mode === 'week');
  document.getElementById('filter-btn-month').classList.toggle('active', mode === 'month');
  document.getElementById('filter-btn-year').classList.toggle('active', mode === 'year');
  document.getElementById('filter-btn-all').classList.toggle('active', mode === 'all');

  document.getElementById('filter-day-box').style.display = (mode === 'day') ? 'block' : 'none';
  document.getElementById('filter-week-box').style.display = (mode === 'week') ? 'block' : 'none';
  document.getElementById('filter-month-box').style.display = (mode === 'month') ? 'block' : 'none';
  document.getElementById('filter-year-box').style.display = (mode === 'year') ? 'block' : 'none';

  if(rerender) renderTimeSessions();
}

function getFilteredSessions(){
  let list = (db.time?.sessions || []).slice();

  if(_sessionFilter.mode === 'day'){
    const day = _sessionFilter.day;
    list = list.filter(s => isoToLocalDateStr(getSessionStart(s)) === day);
  } else if(_sessionFilter.mode === 'week'){
    const range = getWeekRange(_sessionFilter.week);
    if(range){
      list = list.filter(s => {
        const st = getSessionStart(s);
        if(!st) return false;
        const d = new Date(st);
        return d >= range.start && d <= range.end;
      });
    }
  } else if(_sessionFilter.mode === 'month'){
    const m = _sessionFilter.month;
    list = list.filter(s => {
      const d = isoToLocalDateStr(getSessionStart(s));
      return d && d.startsWith(m);
    });
  } else if(_sessionFilter.mode === 'year'){
    const y = String(_sessionFilter.year || '');
    list = list.filter(s => {
      const d = isoToLocalDateStr(getSessionStart(s));
      return d && d.slice(0,4) === y;
    });
  }

  list.sort((a,b)=> new Date(getSessionStart(a) || 0) - new Date(getSessionStart(b) || 0));
  if(_sessionFilter.sort === 'time-desc') list.reverse();
  return list;
}

function renderTimeSessions(){
  const box = document.getElementById('time-sessions');
  if(!box) return;

  const sessions = getFilteredSessions();
  const limit = _sessionFilter.mode === 'all' ? 50 : 999;
  const display = sessions.slice(0, limit);

  if(display.length === 0){
    const modeText = _sessionFilter.mode === 'day' ? 'this day' : (_sessionFilter.mode === 'week' ? 'this week' : 'all time');
    box.innerHTML = `<div style="color:var(--text-sub); font-weight:700;">No sessions for ${modeText}.</div>`;
    return;
  }

  let html = '';
  if(_sessionFilter.mode === 'week'){
    let currentDate = '';
    display.forEach(s => {
      const date = isoToLocalDateStr(getSessionStart(s));
      if(date !== currentDate){
        html += `<div class="session-day">${date}</div>`;
        currentDate = date;
      }
      html += renderSessionRow(s);
    });
  } else {
    html = display.map(renderSessionRow).join('');
  }

  box.innerHTML = html;
}

function renderSessionRow(s){
  const start = getSessionStart(s);
  const end = getSessionEnd(s) || '';
  const date = isoToLocalDateStr(start);
  const startTime = isoToLocalTimeStr(start);
  const endTime = end ? isoToLocalTimeStr(end) : '';
  const { total } = calcSessionDurations(s);

  const app = s.appId ? (db.apps || []).find(a=>a.id === s.appId) : null;
  const appLabel = app ? `${app.company}` : '(No app)';
  const activity = getPrimaryActivity(s);
  const tag = s.tag || 'Other';
  const output = s.output || '';

  return `
    <div class="time-edit-row" style="margin-bottom:8px">
      <input type="date" value="${escapeAttr(date)}" id="ts-date-${s.id}">
      <input type="time" value="${escapeAttr(startTime)}" id="ts-start-${s.id}">
      <input type="time" value="${escapeAttr(endTime)}" id="ts-end-${s.id}">
      <select id="ts-activity-${s.id}">
        ${['Apply','Resume Edit','Networking','Interview Prep','Focus','Break','Other'].map(x => `<option ${x===activity?'selected':''}>${x}</option>`).join('')}
      </select>
      <select id="ts-tag-${s.id}">
        ${TAG_OPTIONS.map(x => `<option ${x===tag?'selected':''}>${x}</option>`).join('')}
      </select>
      <input type="text" id="ts-output-${s.id}" value="${escapeAttr(output)}" placeholder="Output">
      <div style="font-weight:800">${escapeHtml(appLabel)} • ${humanMs(total)}</div>
      <button class="mini-btn" onclick="saveSessionEdit('${s.id}')">Save</button>
      <button class="mini-btn danger" onclick="deleteSession('${s.id}')">Delete</button>
    </div>
  `;
}

function saveSessionEdit(id){
  const s = (db.time.sessions || []).find(x => x.id === id);
  if(!s) return;

  const date = document.getElementById(`ts-date-${id}`)?.value;
  const startTime = document.getElementById(`ts-start-${id}`)?.value;
  const endTime = document.getElementById(`ts-end-${id}`)?.value;
  const act = document.getElementById(`ts-activity-${id}`)?.value || 'Other';
  const tag = document.getElementById(`ts-tag-${id}`)?.value || 'Other';
  const output = document.getElementById(`ts-output-${id}`)?.value || '';

  if(!date || !startTime || !endTime) return alert('Please set date, start time, end time.');

  const start = new Date(`${date}T${startTime}:00`);
  const end = new Date(`${date}T${endTime}:00`);
  if(end <= start) return alert('End time must be later than start time.');

  s.manualStart = start.toISOString();
  s.manualEnd = end.toISOString();
  s.createdAt = s.manualStart;
  s.endedAt = s.manualEnd;

  s.primaryActivity = act;
  s.tag = tag;
  s.output = output;
  s.segments = [{ type: act, start: s.manualStart, end: s.manualEnd }];

  save();
  renderTimeSessions();
  renderTimeCharts();
}

function deleteSession(id){
  if(!confirm('Delete this session?')) return;
  db.time.sessions = (db.time.sessions || []).filter(s => s.id !== id);
  if(db.time.active?.sessionId === id) db.time.active = null;
  save();
  renderTimeSessions();
  renderTimeCharts();
  renderTimerSummary();
}

function mergeShortSessions(){
  const maxMs = 3 * 60 * 1000;
  const gapMs = 10 * 60 * 1000;
  const activeId = db.time.active?.sessionId || null;

  const sessions = (db.time.sessions || []).slice()
    .sort((a,b)=>new Date(getSessionStart(a)) - new Date(getSessionStart(b)));

  const keep = [];
  sessions.forEach(s=>{
    if(activeId && s.id === activeId){
      keep.push(s);
      return;
    }
    const { total } = calcSessionDurations(s);
    const st = new Date(getSessionStart(s)).getTime();
    const en = new Date(getSessionEnd(s) || new Date().toISOString()).getTime();

    if(total <= maxMs && keep.length){
      const prev = keep[keep.length-1];
      const prevEnd = new Date(getSessionEnd(prev) || new Date().toISOString()).getTime();
      const sameDay = isoToLocalDateStr(getSessionStart(prev)) === isoToLocalDateStr(getSessionStart(s));
      const sameMeta = (prev.appId||'')===(s.appId||'') && (prev.tag||'Other')===(s.tag||'Other') && getPrimaryActivity(prev)===getPrimaryActivity(s);
      const gap = st - prevEnd;

      if(sameDay && sameMeta && gap >= 0 && gap <= gapMs){
        const newEnd = new Date(Math.max(prevEnd, en)).toISOString();
        prev.manualStart = prev.manualStart || prev.createdAt;
        prev.manualEnd = newEnd;
        prev.endedAt = newEnd;
        return;
      }
    }
    keep.push(s);
  });

  db.time.sessions = keep.sort((a,b)=>new Date(getSessionStart(b)) - new Date(getSessionStart(a)));
  save();
  renderTimeSessions();
  renderTimeCharts();
}

function timerStart(){
  if(!db.time) db.time = { sessions: [], active: null, pomodoro: null, ideas: [] };
  if(db.time.active) return alert('Timer is already running.');

  const activity = document.getElementById('timer-activity')?.value || 'Apply';
  const tag = document.getElementById('timer-tag')?.value || 'Other';
  const output = document.getElementById('timer-output')?.value || '';
  const appId = document.getElementById('timer-app')?.value || '';
  const dateStr = document.getElementById('timer-date')?.value || new Date().toISOString().slice(0,10);
  const now = new Date();
  const [y,m,d] = dateStr.split('-').map(Number);
  const createdAt = new Date(y, m-1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();

  const session = {
    id: Date.now().toString(),
    appId: appId,
    tag: tag,
    output: output,
    primaryActivity: activity,
    createdAt: createdAt,
    endedAt: null,
    segments: []
  };

  db.time.sessions.unshift(session);
  db.time.active = { sessionId: session.id };

  openNewSegment(session, activity);
  save();
  renderTimerSummary();
  renderTimeSessions();
  renderTimeCharts();
}

function timerBreak(){
  const s = getActiveSession();
  if(!s) return alert('No active timer.');
  closeOpenSegment(s);
  openNewSegment(s, 'Break');
  save();
  renderTimerSummary();
}

function timerResume(){
  const s = getActiveSession();
  if(!s) return alert('No active timer.');

  const activity = document.getElementById('timer-activity')?.value || 'Apply';
  closeOpenSegment(s);
  openNewSegment(s, activity === 'Break' ? 'Apply' : activity);
  save();
  renderTimerSummary();
}

function timerStop(){
  const s = getActiveSession();
  if(!s) return alert('No active timer.');
  closeOpenSegment(s);
  s.endedAt = new Date().toISOString();
  db.time.active = null;
  save();
  renderTimerSummary();
  renderTimeSessions();
  renderTimeCharts();
}

let _timerRaf = null;
let _timerLastShownSec = -1;

function renderTimerSummary(){
  const statusEl = document.getElementById('timer-status');
  const elapsedEl = document.getElementById('timer-elapsed');
  if(!statusEl || !elapsedEl) return;

  const active = !!db.time?.active;

  if(_timerRaf) cancelAnimationFrame(_timerRaf);
  _timerRaf = null;
  _timerLastShownSec = -1;

  if(!active){
    statusEl.textContent = 'Idle';
    elapsedEl.textContent = '00:00:00';
    return;
  }

  const tick = () => {
    const s = getActiveSession();
    if(!s){
      statusEl.textContent = 'Idle';
      elapsedEl.textContent = '00:00:00';
      _timerRaf = null;
      return;
    }

    const total = calcSessionTotalLiveMs(s);
    const sec = Math.floor(total / 1000);

    if(sec !== _timerLastShownSec){
      _timerLastShownSec = sec;
      elapsedEl.textContent = fmtHMS(total);
    }
    statusEl.textContent = 'Running';

    _timerRaf = requestAnimationFrame(tick);
  };

  _timerRaf = requestAnimationFrame(tick);
}

function calcSessionTotalLiveMs(session){
  let total = 0;
  (session.segments || []).forEach(seg=>{
    const st = (seg.startMs ??= Date.parse(seg.start));
    const en = seg.end
      ? (seg.endMs ??= Date.parse(seg.end))
      : Date.now();
    total += Math.max(0, en - st);
  });
  return total;
}

function pomoStart(){
  if(db.time.active) return alert('Stopwatch running. Please stop it first.');
  const workMin = parseInt(document.getElementById('pomo-work').value) || 25;
  const breakMin = parseInt(document.getElementById('pomo-break').value) || 5;
  const cycles = parseInt(document.getElementById('pomo-cycles').value) || 4;
  const tag = document.getElementById('pomo-tag')?.value || 'Deep Work';
  const output = document.getElementById('pomo-output')?.value || '';

  const now = new Date().toISOString();
  const session = {
    id: Date.now().toString(),
    appId: '',
    tag: tag,
    output: output,
    primaryActivity: 'Focus',
    createdAt: now,
    endedAt: null,
    segments: []
  };

  db.time.sessions.unshift(session);
  db.time.active = { sessionId: session.id };

  db.time.pomodoro = {
    phase: 'work',
    remainingMs: workMin * 60000,
    workMs: workMin * 60000,
    breakMs: breakMin * 60000,
    cycles: cycles,
    completed: 0,
    running: true
  };

  openNewSegment(session, 'Focus');
  save();
  pomoTick();
}

function pomoTick(){
  if(_pomoTick) clearInterval(_pomoTick);
  _pomoTick = setInterval(()=>{
    if(!db.time.pomodoro || !db.time.active) return;
    const p = db.time.pomodoro;
    if(!p.running) return;

    p.remainingMs -= 1000;
    updatePomoUI();

    if(p.remainingMs <= 0){
      if(p.phase === 'work'){
        p.phase = 'break';
        p.remainingMs = p.breakMs;
        p.completed += 1;
        const s = getActiveSession();
        closeOpenSegment(s);
        openNewSegment(s, 'Break');
      } else {
        p.phase = 'work';
        p.remainingMs = p.workMs;
        const s = getActiveSession();
        closeOpenSegment(s);
        openNewSegment(s, 'Focus');
      }

      if(p.completed >= p.cycles){
        pomoStop();
      }
      save(true);
    }
  }, 1000);
}

function updatePomoUI(){
  const statusEl = document.getElementById('pomo-status');
  const remainEl = document.getElementById('pomo-remaining');
  if(!statusEl || !remainEl || !db.time.pomodoro) return;

  const p = db.time.pomodoro;
  statusEl.textContent = p.running ? (p.phase === 'work' ? 'Focus' : 'Break') : 'Paused';
  const mm = Math.floor(p.remainingMs / 60000);
  const ss = Math.floor((p.remainingMs % 60000) / 1000);
  remainEl.textContent = `${pad2(mm)}:${pad2(ss)}`;
}

function pomoPause(){
  if(!db.time.pomodoro) return;
  db.time.pomodoro.running = false;
  updatePomoUI();
}

function pomoSkip(){
  if(!db.time.pomodoro) return;
  db.time.pomodoro.remainingMs = 1;
}

function pomoStop(){
  const s = getActiveSession();
  if(s){
    closeOpenSegment(s);
    s.endedAt = new Date().toISOString();
  }
  db.time.active = null;
  db.time.pomodoro = null;
  if(_pomoTick) clearInterval(_pomoTick);
  save();
  renderTimerSummary();
  renderTimeSessions();
  renderTimeCharts();
  updatePomoUI();
}

function renderTimeCharts(){
  const chart = document.getElementById('time-chart');
  const legend = document.getElementById('time-legend');
  const detail = document.getElementById('time-chart-detail');
  if(!chart || !legend || !detail) return;

  const { start, end } = getTimeRange();
  const sessions = getSessionsInRange(start, end);

  if(_chartType === 'pie'){
    const bucket = (_pieGroup === 'tag')
      ? aggregateByTag(sessions)
      : aggregateByActivity(sessions);

    const entries = Object.entries(bucket).sort((a,b)=>b[1]-a[1]);
    const values = entries.map(e=>e[1]);
    const labels = entries.map(e=>e[0]);
    _chartState = { series: values, labels: labels };
    chart.innerHTML = renderPieSVG(values, labels);
    legend.innerHTML = renderLegend(labels, values);
    detail.textContent = 'Click a slice to see details.';
  }

  if(_chartType === 'hist' || _chartType === 'line'){
    const series = aggregateByDate(sessions, start, end);
    _chartState = { series: series.map(x=>x.value), labels: series.map(x=>x.date) };
    chart.innerHTML = (_chartType === 'hist') ? renderHistSVG(series) : renderLineSVG(series);
    legend.innerHTML = '';
    detail.textContent = 'Click a bar/point to see details.';
  }
}

function onChartPointClick(idx){
  const detail = document.getElementById('time-chart-detail');
  if(!detail || !_chartState.series.length) return;

  const val = _chartState.series[idx] || 0;
  const label = _chartState.labels[idx] || '';
  detail.textContent = `${label} — ${humanMs(val)}`;
}

function getTimeRange(){
  const startEl = document.getElementById('time-start-date');
  const endEl = document.getElementById('time-end-date');
  const start = startEl?.value ? new Date(startEl.value) : new Date();
  const end = endEl?.value ? new Date(endEl.value) : new Date();
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);
  return { start, end };
}

function getSessionsInRange(start, end){
  return (db.time?.sessions || []).filter(s => {
    const st = getSessionStart(s);
    if(!st) return false;
    const d = new Date(st);
    return d >= start && d <= end;
  });
}

function aggregateByActivity(sessions){
  const bucket = {};
  sessions.forEach(s=>{
    const { bucket: b } = calcSessionDurations(s);
    Object.entries(b).forEach(([k,ms])=>{
      bucket[k] = (bucket[k] || 0) + ms;
    });
  });
  return bucket;
}

function aggregateByTag(sessions){
  const bucket = {};
  sessions.forEach(s=>{
    const tag = s.tag || 'Other';
    const { total } = calcSessionDurations(s);
    bucket[tag] = (bucket[tag] || 0) + total;
  });
  return bucket;
}

function dateRangeArray(start, end){
  const out = [];
  const d = new Date(start);
  while(d <= end){
    out.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate()+1);
  }
  return out;
}

function aggregateByDate(sessions, start, end){
  const days = dateRangeArray(start, end);
  const map = {};
  days.forEach(d => map[d] = 0);
  sessions.forEach(s=>{
    const d = isoToLocalDateStr(getSessionStart(s));
    if(map[d] !== undefined){
      const { total } = calcSessionDurations(s);
      map[d] += total;
    }
  });
  return days.map(d => ({ date: d, value: map[d] || 0 }));
}

function renderLegend(labels, values){
  if(labels.length === 0) return `<div style="color:var(--text-sub); font-weight:700;">No data</div>`;
  return labels.map((l,i)=>`
    <div class="legend-item">
      <span class="legend-dot" style="background:${chartColor(i)}"></span>
      ${escapeHtml(l)} — ${humanMs(values[i] || 0)}
    </div>
  `).join('');
}

function renderPieSVG(values, labels){
  if(values.length === 0) return `<div style="color:var(--text-sub); font-weight:700;">No data</div>`;
  const total = values.reduce((a,b)=>a+b,0) || 1;
  const cx = 160, cy = 130, r = 90;
  let start = 0;

  const paths = values.map((v,i)=>{
    const angle = (v/total) * Math.PI * 2;
    const end = start + angle;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;
    const path = `
      <path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z"
        fill="${chartColor(i)}" onclick="onChartPointClick(${i})" style="cursor:pointer"></path>
    `;
    start = end;
    return path;
  }).join('');

  return `
    <svg width="100%" height="260" viewBox="0 0 320 260">
      ${paths}
      <circle cx="${cx}" cy="${cy}" r="44" fill="var(--bg)"></circle>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" style="font-weight:900; font-size:16px; fill:var(--text-main)">
        ${humanMs(total)}
      </text>
    </svg>
  `;
}

function renderHistSVG(series){
  if(series.length === 0) return `<div style="color:var(--text-sub); font-weight:700;">No data</div>`;
  const w = 620, h = 220, pad = 28;
  const maxV = Math.max(...series.map(x=>x.value), 1);
  const barW = (w - pad*2) / series.length;

  const bars = series.map((s,i)=>{
    let bh = (s.value / maxV) * (h - 50);
    if (s.value > 0 && bh < 6) bh = 6;
    const x = pad + i * barW;
    const y = h - 20 - bh;
    return `<rect x="${x}" y="${y}" width="${barW-4}" height="${bh}" fill="${chartColor(i)}"
      onclick="onChartPointClick(${i})" style="cursor:pointer"></rect>`;
  }).join('');

  return `
    <svg width="100%" height="260" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="${pad}" y1="${h-20}" x2="${w-pad}" y2="${h-20}" stroke="var(--border)" stroke-width="1"></line>
      ${bars}
    </svg>
  `;
}

function renderLineSVG(series){
  if(series.length === 0) return `<div style="color:var(--text-sub); font-weight:700;">No data</div>`;
  const w = 620, h = 220, pad = 28;
  const maxV = Math.max(...series.map(x=>x.value), 1);
  const step = (w - pad*2) / Math.max(series.length-1,1);

  const points = series.map((s,i)=>{
    const x = pad + i * step;
    const y = h - 20 - (s.value / maxV) * (h - 50);
    return { x, y };
  });

  const path = points.map((p,i)=>`${i===0?'M':'L'}${p.x},${p.y}`).join(' ');

  const circles = points.map((p,i)=>`
    <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${chartColor(i)}"
      onclick="onChartPointClick(${i})" style="cursor:pointer"></circle>
  `).join('');

  return `
    <svg width="100%" height="260" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="${pad}" y1="${h-20}" x2="${w-pad}" y2="${h-20}" stroke="var(--border)" stroke-width="1"></line>
      <path d="${path}" fill="none" stroke="var(--primary)" stroke-width="2"></path>
      ${circles}
    </svg>
  `;
}

function chartColor(i){
  const palette = ['#2563eb','#10b981','#f59e0b','#ef4444','#8b5cf6','#14b8a6','#0ea5e9','#f97316'];
  return palette[i % palette.length];
}

function generateReport(mode){
  const { start, end, label } = getReportRange(mode);
  const sessions = getSessionsInRange(start, end);
  const out = document.getElementById('report-output');

  if(!sessions.length){
    out.value = `Report — ${label}\nNo sessions found.`;
    return;
  }

  let total = 0;
  let focus = 0;
  let longest = { ms: 0, session: null };
  const activityBucket = {};
  const outputs = [];

  sessions.forEach(s=>{
    const { bucket, total: t } = calcSessionDurations(s);
    total += t;
    const breakMs = bucket['Break'] || 0;
    focus += (t - breakMs);

    if(t > longest.ms) longest = { ms: t, session: s };

    Object.entries(bucket).forEach(([k,ms])=>{
      activityBucket[k] = (activityBucket[k] || 0) + ms;
    });

    if(s.output && s.output.trim()){
      outputs.push(`${isoToLocalDateStr(getSessionStart(s))}: ${s.output.trim()}`);
    }
  });

  const top = Object.entries(activityBucket)
    .filter(([k])=>k !== 'Break')
    .sort((a,b)=>b[1]-a[1])
    .slice(0,3);

  const focusHours = focus / 3600000;
  const outputCount = outputs.length;
  const outputRate = focusHours > 0 ? (outputCount / focusHours).toFixed(2) : '—';

  const longestText = longest.session ? `${humanMs(longest.ms)} (${formatSessionRange(longest.session)})` : '—';

  const lines = [
    `Report — ${label}`,
    `Range: ${formatDate(start)} to ${formatDate(end)}`,
    `Total Focus: ${humanMs(focus)}`,
    `Total Time: ${humanMs(total)}`,
    `Longest Session: ${longestText}`,
    `Outputs Recorded: ${outputCount} (Outputs/hour: ${outputRate})`,
    `Top Activities:`,
    ...top.map((t,i)=>`${i+1}. ${t[0]} — ${humanMs(t[1])}`)
  ];

  if(outputs.length){
    lines.push('Outputs:');
    outputs.slice(0,10).forEach((o,i)=>lines.push(`${i+1}. ${o}`));
  }

  out.value = lines.join('\n');
  saveReportToIdeas(mode, out.value, label, start, end);
}

function getReportRange(mode){
  const today = new Date();
  if(mode === 'today'){
    const start = new Date(today); start.setHours(0,0,0,0);
    const end = new Date(today); end.setHours(23,59,59,999);
    return { start, end, label: `Today (${formatDate(start)})` };
  }
  const currentDay = today.getDay();
  const distanceToMonday = (currentDay + 6) % 7;
  const monday = new Date(today);
  monday.setDate(today.getDate() - distanceToMonday);
  monday.setHours(0,0,0,0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23,59,59,999);

  return { start: monday, end: sunday, label: `This Week (${formatDate(monday)} - ${formatDate(sunday)})` };
}

function formatSessionRange(s){
  const st = getSessionStart(s);
  const en = getSessionEnd(s) || '';
  if(!st) return '—';
  const stStr = `${isoToLocalDateStr(st)} ${isoToLocalTimeStr(st)}`;
  const enStr = en ? isoToLocalTimeStr(en) : '—';
  return `${stStr} - ${enStr}`;
}

function formatDate(d){ return d.toISOString().slice(0,10); }

function copyReport(){
  const out = document.getElementById('report-output');
  if(!out || !out.value) return;
  navigator.clipboard.writeText(out.value).then(()=>alert('Copied ✅'));
}

function saveReportToIdeas(mode, text, label, start, end){
  if(!db.time) db.time = { sessions: [], active: null, pomodoro: null, ideas: [] };
  if(!Array.isArray(db.time.ideas)) db.time.ideas = [];

  if(!db.config.ideaTags.includes('Report')) db.config.ideaTags.push('Report');

  const reportKey = `${mode}:${formatDate(start)}:${formatDate(end)}`;
  const title = `Report — ${label}`;
  const summary = `Auto-saved from Time Tracker (${mode}).`;

  const idx = db.time.ideas.findIndex(i => i.reportKey === reportKey);
  const patch = {
    date: formatDate(end),
    tag: 'Report',
    title,
    summary,
    content: text,
    review: '',
    next: '',
    reportKey,
    archived: false,
    completed: false,
    collapsed: true,
    updatedAt: new Date().toISOString()
  };

  if(idx >= 0){
    db.time.ideas[idx] = { ...db.time.ideas[idx], ...patch };
  } else {
    db.time.ideas.unshift({
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      ...patch
    });
  }

  save(true);
}

function renderIdeas(){
  refreshIdeaTagSelect();
  refreshIdeaFilterTagSelect();
  renderIdeaTagList();

  const dateEl = document.getElementById('idea-date');
  if(dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0,10);

  const statusSel = document.getElementById('idea-filter-status');
  const sortSel = document.getElementById('idea-sort');
  if(statusSel && !statusSel.value) statusSel.value = _ideaFilter.status;
  if(sortSel && !sortSel.value) sortSel.value = _ideaFilter.sort;

  onIdeaFilterChange();
}

function refreshIdeaTagSelect(){
  const sel = document.getElementById('idea-tag');
  if(!sel) return;
  sel.innerHTML = db.config.ideaTags.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('');
}

function renderIdeaTagList(){
  const box = document.getElementById('idea-tag-list');
  if(!box) return;
  box.innerHTML = db.config.ideaTags.map(t => `
    <span class="tag-pill">
      ${escapeHtml(t)}
      <button class="edit" onclick="renameIdeaTag('${escapeAttr(t)}')">✎</button>
      <button onclick="removeIdeaTag('${escapeAttr(t)}')">×</button>
    </span>
  `).join('');
}

function addIdeaTag(){
  const input = document.getElementById('idea-tag-new');
  const val = (input?.value || '').trim();
  if(!val) return;
  if(!db.config.ideaTags.includes(val)) db.config.ideaTags.push(val);
  input.value = '';
  save();
  refreshIdeaTagSelect();
  renderIdeaTagList();
}

function renameIdeaTag(oldTag){
  const n = prompt('Rename tag:', oldTag);
  if(!n || n.trim() === oldTag) return;
  const newTag = n.trim();
  db.config.ideaTags = db.config.ideaTags.map(t => t === oldTag ? newTag : t);
  db.time.ideas.forEach(i => { if(i.tag === oldTag) i.tag = newTag; });
  save();
  refreshIdeaTagSelect();
  renderIdeaTagList();
  renderIdeaList();
}

function removeIdeaTag(tag){
  if(!confirm(`Delete tag "${tag}"?`)) return;
  db.config.ideaTags = db.config.ideaTags.filter(t => t !== tag);
  db.time.ideas.forEach(i => { if(i.tag === tag) i.tag = 'Idea'; });
  save();
  refreshIdeaTagSelect();
  renderIdeaTagList();
  renderIdeaList();
}

function saveIdea(){
  const id = document.getElementById('idea-id').value;
  const date = document.getElementById('idea-date').value;
  const tag = document.getElementById('idea-tag').value;
  const title = document.getElementById('idea-title').value;
  const summary = document.getElementById('idea-summary').value;
  const content = document.getElementById('idea-content').value;
  const review = document.getElementById('idea-review').value;
  const next = document.getElementById('idea-next').value;

  if(!title && !content) return alert('Please add a title or content.');

  if(!db.time) db.time = { sessions: [], active: null, pomodoro: null, ideas: [] };
  if(!Array.isArray(db.time.ideas)) db.time.ideas = [];

  if(id){
    const idx = db.time.ideas.findIndex(x => x.id === id);
    if(idx >= 0){
      const old = db.time.ideas[idx];
      db.time.ideas[idx] = {
        ...old,
        date, tag, title, summary, content, review, next,
        updatedAt: new Date().toISOString()
      };
    }
  } else {
    db.time.ideas.unshift({
      id: Date.now().toString(),
      date, tag, title, summary, content, review, next,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      archived: false,
      completed: false,
      archivedAt: null,
      completedAt: null,
      collapsed: true,
      reportKey: null
    });
  }

  save();
  clearIdeaForm();
  renderIdeaList();
}

function clearIdeaForm(){
  document.getElementById('idea-id').value = '';
  document.getElementById('idea-title').value = '';
  document.getElementById('idea-summary').value = '';
  document.getElementById('idea-content').value = '';
  document.getElementById('idea-review').value = '';
  document.getElementById('idea-next').value = '';
}

function editIdea(id){
  const idea = db.time.ideas.find(i => i.id === id);
  if(!idea) return;
  document.getElementById('idea-id').value = idea.id;
  document.getElementById('idea-date').value = idea.date || new Date().toISOString().slice(0,10);
  document.getElementById('idea-tag').value = idea.tag || 'Idea';
  document.getElementById('idea-title').value = idea.title || '';
  document.getElementById('idea-summary').value = idea.summary || '';
  document.getElementById('idea-content').value = idea.content || '';
  document.getElementById('idea-review').value = idea.review || '';
  document.getElementById('idea-next').value = idea.next || '';
}

function deleteIdea(id){
  if(!confirm('Delete this idea?')) return;
  db.time.ideas = db.time.ideas.filter(i => i.id !== id);
  save();
  renderIdeaList();
}

let _ideaFilter = { q:'', tag:'', status:'active', sort:'date-desc' };

function onIdeaFilterChange(){
  _ideaFilter.q = (document.getElementById('idea-search')?.value || '').trim().toLowerCase();
  _ideaFilter.tag = (document.getElementById('idea-filter-tag')?.value || '');
  _ideaFilter.status = (document.getElementById('idea-filter-status')?.value || 'active');
  _ideaFilter.sort = (document.getElementById('idea-sort')?.value || 'date-desc');
  renderIdeaList();
}

function clearIdeaFilters(){
  _ideaFilter = { q:'', tag:'', status:'active', sort:'date-desc' };
  const q = document.getElementById('idea-search');
  const t = document.getElementById('idea-filter-tag');
  const s = document.getElementById('idea-filter-status');
  const o = document.getElementById('idea-sort');
  if(q) q.value = '';
  if(t) t.value = '';
  if(s) s.value = 'active';
  if(o) o.value = 'date-desc';
  renderIdeaList();
}

function refreshIdeaFilterTagSelect(){
  const sel = document.getElementById('idea-filter-tag');
  if(!sel) return;
  sel.innerHTML = `<option value="">All Tags</option>` + db.config.ideaTags
    .map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`)
    .join('');
}

function renderIdeaList(){
  const box = document.getElementById('idea-list');
  if(!box) return;

  let list = (db.time.ideas || []).slice();

  if(_ideaFilter.status === 'active'){
    list = list.filter(i => !i.archived && !i.completed);
  } else if(_ideaFilter.status === 'done'){
    list = list.filter(i => !!i.completed);
  } else if(_ideaFilter.status === 'archived'){
    list = list.filter(i => !!i.archived);
  }

  if(_ideaFilter.tag){
    list = list.filter(i => (i.tag || 'Idea') === _ideaFilter.tag);
  }

  if(_ideaFilter.q){
    const q = _ideaFilter.q;
    list = list.filter(i=>{
      const hay = [
        i.title, i.summary, i.content, i.review, i.next, i.tag, i.date
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  if(_ideaFilter.sort === 'date-asc'){
    list.sort((a,b)=> (a.date||'').localeCompare(b.date||''));
  } else if(_ideaFilter.sort === 'title-asc'){
    list.sort((a,b)=> (a.title||'').localeCompare(b.title||''));
  } else {
    list.sort((a,b)=> (b.date||'').localeCompare(a.date||''));
  }

  if(!list.length){
    box.innerHTML = `<div class="small-note">No ideas found.</div>`;
    return;
  }

  box.innerHTML = list.map(i => {
    const collapsed = (i.collapsed === undefined) ? true : !!i.collapsed;

    const badges = `
      <div class="idea-badges">
        ${i.completed ? `<span class="badge done">✅ Completed</span>` : ``}
        ${i.archived ? `<span class="badge archived">📦 Archived</span>` : ``}
      </div>
    `;

    const bodyParts = [
      i.summary ? `<div style="color:var(--text-sub); margin-top:4px">${escapeHtml(i.summary)}</div>` : '',
      i.content ? `<div style="margin-top:6px">${escapeHtml(i.content)}</div>` : '',
      i.review ? `<div style="margin-top:6px"><b>Review:</b> ${escapeHtml(i.review)}</div>` : '',
      i.next ? `<div style="margin-top:6px"><b>Next:</b> ${escapeHtml(i.next)}</div>` : ''
    ].join('');

    return `
      <div class="idea-item">
        <div class="idea-meta">
          <span>
            <span class="idea-tag">${escapeHtml(i.tag || 'Idea')}</span> • ${escapeHtml(i.date || '')}
          </span>
          <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
            <button class="mini-btn" onclick="toggleIdeaCompleted('${escapeAttr(i.id)}')">
              ${i.completed ? 'Undo' : 'Mark done'}
            </button>
            <button class="mini-btn" onclick="toggleIdeaArchive('${escapeAttr(i.id)}')">
              ${i.archived ? 'Unarchive' : 'Archive'}
            </button>
            <button class="mini-btn" onclick="toggleIdeaCollapsed('${escapeAttr(i.id)}')">
              ${collapsed ? 'Expand' : 'Collapse'}
            </button>
            <button class="mini-btn" onclick="editIdea('${escapeAttr(i.id)}')">Edit</button>
            <button class="mini-btn danger" onclick="deleteIdea('${escapeAttr(i.id)}')">Delete</button>
          </div>
        </div>

        ${badges}

        <div style="font-weight:900; margin-top:6px">${escapeHtml(i.title || 'Untitled')}</div>

        <div class="idea-body ${collapsed ? 'collapsed' : ''}" id="idea-body-${escapeAttr(i.id)}">
          ${bodyParts}
        </div>

        ${(bodyParts.trim().length > 0) ? `
          <div class="idea-toggle" onclick="toggleIdeaCollapsed('${escapeAttr(i.id)}')">
            ${collapsed ? '▶ Expand' : '▼ Collapse'}
          </div>
        ` : ``}
      </div>
    `;
  }).join('');
}

function toggleIdeaArchive(id){
  const i = (db.time.ideas || []).find(x => x.id === id);
  if(!i) return;
  i.archived = !i.archived;
  i.archivedAt = i.archived ? new Date().toISOString() : null;
  save();
  renderIdeaList();
}

function toggleIdeaCompleted(id){
  const i = (db.time.ideas || []).find(x => x.id === id);
  if(!i) return;
  i.completed = !i.completed;
  i.completedAt = i.completed ? new Date().toISOString() : null;
  save();
  renderIdeaList();
}

function toggleIdeaCollapsed(id){
  const i = (db.time.ideas || []).find(x => x.id === id);
  if(!i) return;
  i.collapsed = !i.collapsed;
  save(true);
  renderIdeaList();
}

function parseTags(str) {
  if (!str) return [];
  return str
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.replace(/^#/, ''))
    .slice(0, 30);
}

function escapeHtml(str) {
  return (str || '').toString()
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#096;');
}
function escapeRegex(str){
  return (str || '').replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function pad2(n){ return (n<10 ? '0' : '') + n; }

function dateOnlyToISO(dateStr){
  const parts = (dateStr || '').split('-').map(Number);
  if(parts.length !== 3 || !parts[0]) return new Date().toISOString();
  const d = new Date(parts[0], parts[1]-1, parts[2], 12, 0, 0);
  return d.toISOString();
}

function daysSinceDateOnly(dateStr){
  if(!dateStr) return 0;
  const [y,m,d] = dateStr.split('-').map(Number);
  const start = new Date(y, m-1, d, 12, 0, 0);
  const now = new Date();
  return Math.floor((now - start) / (1000*60*60*24));
}

function hoursSinceISO(tsISO){
  const d = new Date(tsISO);
  const now = new Date();
  return Math.floor((now - d) / (1000*60*60));
}

function fmtNumber(x){
  if(x === null || x === undefined) return '—';
  return (Math.round(x*10)/10).toFixed(1);
}

function getSessionStart(session){ return session.manualStart || session.createdAt; }
function getSessionEnd(session){ return session.manualEnd || session.endedAt; }

function getPrimaryActivity(session){
  if(session.primaryActivity) return session.primaryActivity;
  const seg = (session.segments || []).find(s=>s.type && s.type !== 'Break');
  return seg ? seg.type : 'Other';
}

function calcSessionDurations(session){
  const bucket = {};
  let total = 0;

  (session.segments || []).forEach(seg=>{
    const st = new Date(seg.start).getTime();
    const en = seg.end ? new Date(seg.end).getTime() : Date.now();
    const ms = Math.max(0, en - st);
    bucket[seg.type] = (bucket[seg.type] || 0) + ms;
    total += ms;
  });

  const manualTotal = (session.manualStart && session.manualEnd) ? (new Date(session.manualEnd) - new Date(session.manualStart)) : null;
  if(manualTotal && manualTotal > 0){
    if(total > 0){
      const scale = manualTotal / total;
      Object.keys(bucket).forEach(k => bucket[k] = bucket[k] * scale);
    }
    total = manualTotal;
  }

  return { bucket, total };
}

function humanMs(ms){
  const h = ms/3600000;
  if(h >= 1) return `${h.toFixed(2)}h`;
  const m = ms/60000;
  return `${m.toFixed(1)}m`;
}

function getWeekInputValue(date){
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

function getWeekRange(weekStr){
  if(!weekStr || !weekStr.includes('-W')) return null;
  const [y, w] = weekStr.split('-W').map(Number);
  const simple = new Date(y, 0, 1 + (w - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = new Date(simple);
  if (dow <= 4) ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  else ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  ISOweekStart.setHours(0,0,0,0);
  const end = new Date(ISOweekStart);
  end.setDate(ISOweekStart.getDate() + 6);
  end.setHours(23,59,59,999);
  return { start: ISOweekStart, end };
}

function getActiveSession(){
  const id = db.time?.active?.sessionId;
  if(!id) return null;
  return (db.time.sessions || []).find(s => s.id === id) || null;
}

function openNewSegment(session, type){
  if(!session) return;
  if(!session.segments) session.segments = [];
  const nowIso = new Date().toISOString();
  session.segments.push({
    type,
    start: nowIso,
    end: null,
    startMs: Date.now(),
    endMs: null
  });
}

function closeOpenSegment(session){
  if(!session || !Array.isArray(session.segments)) return;
  for(let i=session.segments.length-1; i>=0; i--){
    const seg = session.segments[i];
    if(seg && !seg.end){
      seg.end = new Date().toISOString();
      seg.endMs = Date.now();
      return;
    }
  }
}
function fmtHMS(ms){
  ms = Math.max(0, ms|0);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

init();