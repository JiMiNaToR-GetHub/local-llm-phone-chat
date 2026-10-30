const RANK = [
  "gemma-4-26b-a4b-it-qat",
  "deepseek-r1-0528-qwen3-8b@q8_0",
  "gemma-3-27b-it-qat",
  "deepseek-r1-0528-qwen3-8b@q4_k_m",
  "nousresearch_hermes-4-14b",
  "qwen/qwen3.5-9b",
  "qwen3-vl-8b-instruct",
  "google/gemma-4-e4b",
  "qwen3-8b",
  "deepseek/deepseek-r1-0528-qwen3-8b",
  "google/gemma-3-27b"
];

const LABELS = {
  "gemma-4-26b-a4b-it-qat": "Gemma 4 26B-A4B · best overall",
  "deepseek-r1-0528-qwen3-8b@q8_0": "DeepSeek R1 8B Q8 · reasoning",
  "gemma-3-27b-it-qat": "Gemma 3 27B",
  "deepseek-r1-0528-qwen3-8b@q4_k_m": "DeepSeek R1 8B Q4 · fast",
  "nousresearch_hermes-4-14b": "Hermes 4 14B",
  "qwen/qwen3.5-9b": "Qwen3.5 9B",
  "qwen3-vl-8b-instruct": "Qwen3-VL 8B",
  "google/gemma-4-e4b": "Gemma 4 E4B",
  "qwen3-8b": "Qwen3 8B"
};

const HIDDEN = ["deepseek/deepseek-r1-0528-qwen3-8b", "google/gemma-3-27b"];
const DEFAULT_MODEL = "gemma-4-26b-a4b-it-qat";

const el = {
  sel: document.getElementById('model'),
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  statusDot: document.getElementById('status-dot'),
  msgs: document.getElementById('messages'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  newChat: document.getElementById('new'),
  wakeBtn: document.getElementById('wake-btn'),
  hibernateBtn: document.getElementById('hibernate-btn'),
  ncmBtn: document.getElementById('ncm-btn'),
  agentBtn: document.getElementById('agent-btn'),
  projectSel: document.getElementById('project-select'),
  fileInput: document.getElementById('file-input'),
  mediaBtn: document.getElementById('media-btn'),
};

let messages = [];
let controller = null;
let busy = false;
let currentAttachments = [];
let agentMode = false;
let ncmMode = false;
let chatId = localStorage.getItem('chatId') || null;

function setStatus(text, isErr) {
  if (el.statusText) el.statusText.textContent = text;
  if (el.statusDot) {
    if (isErr) {
      el.statusDot.className = 'dot offline';
    } else if (text.toLowerCase().includes('connecting') || text.toLowerCase().includes('waking')) {
      el.statusDot.className = 'dot waking';
    } else {
      el.statusDot.className = 'dot ready';
    }
  }
}

let healthInterval = null;
function startHealthPoll() {
  if (healthInterval) return;
  setStatus('PC Offline · Waking...', true);
  healthInterval = setInterval(async () => {
    try {
      const res = await fetch(`${location.origin}/health`);
      if (res.ok) {
        clearInterval(healthInterval);
        healthInterval = null;
        setStatus('Connecting...', false);
        loadModels();
        loadProjects();
      }
    } catch (e) {}
  }, 5000);
}

function rankOf(id) {
  const i = RANK.indexOf(id);
  return i === -1 ? 999 : i;
}

let projectMap = {};

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    let options = '<option value="">Root (G:\\Local_LLM_Storage)</option>';
    options += '<option value="__new__" style="color: var(--primary); font-weight: bold;">+ New Project</option>';
    for (const p of projects) {
      projectMap[p.id] = p.workingDir;
      options += `<option value="${p.id}">${p.name}</option>`;
    }
    el.projectSel.innerHTML = options;
  } catch (e) {
    console.error('Failed to load projects', e);
  }
}

async function loadModels() {
  try {
    const res = await fetch(`${location.origin}/v1/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.data || [])
      .filter(m => !/embed|nomic/i.test(m.id))
      .filter(m => !HIDDEN.includes(m.id))
      .sort((a, b) => rankOf(a.id) - rankOf(b.id) || a.id.localeCompare(b.id));
    
    let options = '<option disabled selected>Select Model</option>' + models.map(m => {
      const i = rankOf(m.id);
      const prefix = i < 900 ? `${i + 1}. ` : '';
      return `<option value="${m.id}">${prefix}${LABELS[m.id] || m.id}</option>`;
    }).join('');

    try {
      const cloudRes = await fetch('/api/cloud-models');
      const cloudModels = await cloudRes.json();
      if (Array.isArray(cloudModels) && cloudModels.length > 0) {
        options += '<option disabled>────────── Cloud (Bionic+) ──────────</option>';
        options += cloudModels.map(m => `<option value="${m.id}">☁️ ${m.name} (Desktop only)</option>`).join('');
      }
    } catch (e) {
      console.error('Failed to load cloud models', e);
    }

    el.sel.innerHTML = options;

    const saved = localStorage.getItem('model');
    if (saved) {
      const exists = [...el.sel.options].some(o => o.value === saved);
      if (exists) el.sel.value = saved;
    }
    if (!el.sel.value && models.some(m => m.id === DEFAULT_MODEL)) {
      el.sel.value = DEFAULT_MODEL;
    }
    
    setStatus(`Ready · ${models.length} models`);
  } catch (e) {
    setStatus(`Offline: ${e.message}`, true);
    startHealthPoll();
  }
}

let rafId = null;
function scheduleRender() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    render();
    rafId = null;
  });
}

function updateLastBotMessage(bot) {
  const lastMsgEl = el.msgs.lastElementChild;
  if (!lastMsgEl) return;
  
  if (bot.reasoning) {
    let d = lastMsgEl.querySelector('details.think');
    if (!d) {
      d = document.createElement('details');
      d.className = 'think';
      d.open = true;
      d.innerHTML = '<summary>thinking</summary>';
      const p = document.createElement('div');
      d.appendChild(p);
      lastMsgEl.prepend(d);
    }
    const p = d.querySelector('div');
    if (p) p.textContent = bot.reasoning;
  }

  if (bot.content) {
    let body = lastMsgEl.querySelector('.msg-content');
    if (!body) {
      body = document.createElement('div');
      body.className = 'msg-content';
      lastMsgEl.appendChild(body);
    }
    body.innerHTML = parseMarkdown(bot.content);
  }
  
  if (autoScroll) {
    el.msgs.scrollTop = el.msgs.scrollHeight;
  }
}

let autoScroll = true;
el.msgs.addEventListener('scroll', () => {
  autoScroll = el.msgs.scrollHeight - el.msgs.scrollTop <= el.msgs.clientHeight + 50;
});

function parseMarkdown(text) {
  if (!text) return '';
  let html = marked.parse(text);
  html = html.replace(/<pre><code class="language-([^"]+)">([\s\S]*?)<\/code><\/pre>/g, (match, lang, code) => {
    return `<div class="code-block"><div class="code-header"><span>${lang}</span><button onclick="copyCode(this)">Copy</button></div><pre><code>${code}</code></pre></div>`;
  });
  html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (match, code) => {
    return `<div class="code-block"><div class="code-header"><span>code</span><button onclick="copyCode(this)">Copy</button></div><pre><code>${code}</code></pre></div>`;
  });
  return html;
}

window.copyCode = function(btn) {
  const code = btn.closest('.code-block').querySelector('code').innerText;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  });
};

let streamRafId = null;
function scheduleStreamUpdate(bot) {
  if (streamRafId) return;
  streamRafId = requestAnimationFrame(() => {
    updateLastBotMessage(bot);
    streamRafId = null;
  });
}

function render() {
  el.msgs.innerHTML = '';
  for (const m of messages) {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot');
    
    if (m.reasoning) {
      const d = document.createElement('details');
      d.className = 'think';
      d.open = true;
      d.innerHTML = '<summary>thinking</summary>';
      const p = document.createElement('div');
      p.textContent = m.reasoning;
      d.appendChild(p);
      div.appendChild(d);
    }

    if (Array.isArray(m.content)) {
      m.content.forEach(part => {
        if (part.type === 'text') {
          const p = document.createElement('div');
          p.textContent = part.text;
          div.appendChild(p);
        } else if (part.type === 'image_url') {
          const img = document.createElement('img');
          img.src = part.image_url.url;
          img.style.maxWidth = '100%';
          img.style.borderRadius = '8px';
          img.style.marginBottom = '8px';
          div.appendChild(img);
        }
      });
    } else {
      const body = document.createElement('div');
      body.className = 'msg-content';
      if (m.role === 'assistant' && m.content) {
        body.innerHTML = parseMarkdown(m.content);
      } else {
        body.textContent = m.content;
      }
      div.appendChild(body);
    }

    if (m.role === 'assistant' && m.meta) {
      const meta = document.createElement('div');
      meta.className = 'msg-status';
      meta.textContent = m.meta;
      div.prepend(meta);
    }
    el.msgs.appendChild(div);
  }
  if (autoScroll) {
    el.msgs.scrollTop = el.msgs.scrollHeight;
  }
}

function persist() {
  localStorage.setItem('chat', JSON.stringify(messages));
  localStorage.setItem('model', el.sel.value);
}

async function saveChat() {
  if (!chatId) return;
  try {
    await fetch('/api/save-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, messages, timestamp: Date.now() })
    });
  } catch (e) {
    console.error('Failed to save chat', e);
  }
}

const TOOLS = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders in a directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path to the directory. Use '' for the root." } },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search for a text string across files in the project.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The text to search for." },
          dir: { type: "string", description: "Relative directory to search in (optional)." }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file or folder.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path to delete." } },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "create_folder",
      description: "Create a new directory.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path of the directory to create." } },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description: "Fetch the text content of a web page.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The URL to fetch." } },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web using DuckDuckGo.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "The search query." } },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the contents of a file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Relative path to the file." } },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Edit a file by replacing an exact string with a new string. Use this for small changes instead of overwriting the whole file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file." },
          old_string: { type: "string", description: "The exact string to replace." },
          new_string: { type: "string", description: "The new string to replace it with." }
        },
        required: ["path", "old_string", "new_string"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a shell command (PowerShell on Windows) in the project directory.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to run." },
          cwd: { type: "string", description: "Relative working directory (optional)." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path to the file." },
          content: { type: "string", description: "The full content to write." }
        },
        required: ["path", "content"]
      }
    }
  }
];

let allowAllTools = false;
let confirmResolve = null;

function confirmAction(name, args) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    const modal = document.getElementById('confirm-modal');
    const details = document.getElementById('confirm-details');
    let detailText = `Tool: ${name}\n`;
    if (args.command) detailText += `\nCommand:\n${args.command}`;
    else if (args.path) detailText += `\nPath:\n${args.path}`;
    else detailText += `\n${JSON.stringify(args, null, 2)}`;
    details.textContent = detailText;
    modal.style.display = 'flex';
  });
}

document.getElementById('confirm-cancel').onclick = () => {
  document.getElementById('confirm-modal').style.display = 'none';
  if (confirmResolve) confirmResolve(false);
  confirmResolve = null;
};
document.getElementById('confirm-allow').onclick = () => {
  document.getElementById('confirm-modal').style.display = 'none';
  if (confirmResolve) confirmResolve(true);
  confirmResolve = null;
};
document.getElementById('confirm-allow-all').onclick = () => {
  document.getElementById('confirm-modal').style.display = 'none';
  if (confirmResolve) confirmResolve('allow_all');
  confirmResolve = null;
};

async function executeTool(tc) {
  const projectId = el.projectSel.value;
  const root = projectId && projectMap[projectId] ? projectMap[projectId] : 'G:\\Local_LLM_Storage';
  const { name, arguments: argsStr } = tc.function;
  let args;
  try { 
    args = JSON.parse(argsStr); 
  } catch (e) { 
    return "Error: The arguments you provided are not valid JSON. Please double-check your syntax, escape your strings properly, and try again."; 
  }
  
  const riskyTools = ['run_command', 'delete_file'];
  if (riskyTools.includes(name) && !allowAllTools) {
    const decision = await confirmAction(name, args);
    if (decision === 'allow_all') {
      allowAllTools = true;
    } else if (decision === false) {
      return 'User denied permission to execute this tool.';
    }
  }
  
  let url = '', body = {};
  if (name === 'read_file') { url = '/api/tools/read'; body = { path: args.path, root }; }
  else if (name === 'write_file') { url = '/api/tools/write'; body = { path: args.path, content: args.content, root }; }
  else if (name === 'edit_file') { url = '/api/tools/edit'; body = { path: args.path, old_string: args.old_string, new_string: args.new_string, root }; }
  else if (name === 'run_command') { url = '/api/tools/run'; body = { command: args.command, cwd: args.cwd, root }; }
  else if (name === 'list_dir') { url = '/api/tools/list'; body = { path: args.path, root }; }
  else if (name === 'search_files') { url = '/api/tools/search'; body = { query: args.query, dir: args.dir, root }; }
  else if (name === 'delete_file') { url = '/api/tools/delete'; body = { path: args.path, root }; }
  else if (name === 'create_folder') { url = '/api/tools/mkdir'; body = { path: args.path, root }; }
  else if (name === 'fetch_url') { url = '/api/tools/fetch'; body = { url: args.url }; }
  else if (name === 'search_web') { url = '/api/tools/search_web'; body = { query: args.query }; }
  else return `Unknown tool: ${name}`;

  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    return JSON.stringify(data);
  } catch (e) {
    return `Error executing tool: ${e.message}`;
  }
}

function updateAttachmentsUI() {
  const preview = document.getElementById('attachments-preview');
  if (currentAttachments.length === 0) {
    preview.style.display = 'none';
    preview.innerHTML = '';
    el.input.placeholder = "Message...";
    return;
  }
  preview.style.display = 'flex';
  preview.innerHTML = currentAttachments.map((att, i) => {
    const isImg = att.type === 'image';
    return `<div class="attachment-chip">
      ${isImg ? `<img src="${att.data}" />` : `<span>📄</span>`}
      <span>${att.name}</span>
      <button class="remove-btn" onclick="removeAttachment(${i})">×</button>
    </div>`;
  }).join('');
}

function removeAttachment(index) {
  currentAttachments.splice(index, 1);
  updateAttachmentsUI();
  updateSendState();
}

let metricsInterval = null;
let wakeLock = null;
let wakeVideo = null;
let wakeCanvas = null;
let wakeCtx = null;
let wakeInterval = null;

function initWakeVideo() {
  wakeVideo = document.getElementById('wake-video');
  wakeCanvas = document.createElement('canvas');
  wakeCanvas.width = 1;
  wakeCanvas.height = 1;
  wakeCtx = wakeCanvas.getContext('2d');
}

async function requestWakeLock() {
  // 1. Try native Wake Lock API (requires HTTPS)
  if ('wakeLock' in navigator && window.isSecureContext) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      return;
    } catch (err) {
      console.error('Native Wake Lock failed:', err);
    }
  }
  
  // 2. Fallback: Hidden Canvas Video Stream (works on HTTP)
  if (!wakeVideo) initWakeVideo();
  if (wakeVideo) {
    try {
      if (!wakeVideo.srcObject) {
        const stream = wakeCanvas.captureStream(1);
        wakeVideo.srcObject = stream;
      }
      await wakeVideo.play();
      if (wakeInterval) clearInterval(wakeInterval);
      wakeInterval = setInterval(() => {
        wakeCtx.fillStyle = wakeCtx.fillStyle === '#000' ? '#001' : '#000';
        wakeCtx.fillRect(0, 0, 1, 1);
      }, 1000);
    } catch (err) {
      console.error('Video Wake Lock fallback failed:', err);
    }
  }
}

function releaseWakeLock() {
  if (wakeLock !== null) {
    wakeLock.release().then(() => { wakeLock = null; }).catch(console.error);
  }
  if (wakeVideo) {
    wakeVideo.pause();
  }
  if (wakeInterval) {
    clearInterval(wakeInterval);
    wakeInterval = null;
  }
}

function updateSendState() {
  el.send.disabled = !el.input.value.trim() && currentAttachments.length === 0;
}

function autoGrow() {
  el.input.style.height = 'auto';
  el.input.style.height = Math.min(el.input.scrollHeight, 120) + 'px';
  updateSendState();
}

async function handleFiles(files) {
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      const base64 = await fileToBase64(file);
      currentAttachments.push({ type: 'image', data: base64, name: file.name });
      fetch('/api/save-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: file.name, data: base64 })
      }).catch(console.error);
    } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
      const text = await file.text();
      currentAttachments.push({ type: 'text', data: text, name: file.name });
    } else {
      alert(`Unsupported file type: ${file.name}. Use images or .txt files.`);
    }
  }
  el.input.value = '';
  autoGrow();
  updateAttachmentsUI();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function send() {
  let text = el.input.value.trim();
  if (!text && currentAttachments.length === 0) return;
  
  if (busy) return;

  if (!chatId) {
    chatId = new Date().toISOString().replace(/[:.]/g, '-');
    localStorage.setItem('chatId', chatId);
  }

  const messageContent = [];
  if (text) messageContent.push({ type: 'text', text: text });
  
  for (const att of currentAttachments) {
    if (att.type === 'image') {
      messageContent.push({ type: 'image_url', image_url: { url: att.data } });
    } else {
      messageContent.push({ type: 'text', text: `[File: ${att.name}]\n${att.data}` });
    }
  }

  let finalContent;
  if (messageContent.length === 1 && messageContent[0].type === 'text') {
    finalContent = messageContent[0].text;
  } else {
    finalContent = messageContent;
  }

  messages.push({ role: 'user', content: finalContent });
  
  el.input.value = '';
  currentAttachments = [];
  autoGrow();
  updateAttachmentsUI();
  
  render();
  persist();
  saveChat();

  busy = true;
  requestWakeLock();
  
  if (metricsInterval) clearInterval(metricsInterval);
  metricsInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/metrics');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const bar = document.getElementById('metrics-bar');
      if (bar) {
        bar.textContent = `CPU: ${data.cpu}% | GPU: ${data.gpu}% | VRAM: ${data.vram}GB`;
        bar.style.display = 'block';
      }
    } catch (e) {
      console.error('Metrics error', e);
    }
  }, 5000);

  el.send.disabled = true;
  el.send.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  
  const agentStatus = document.getElementById('agent-status');
  if (agentStatus) {
    agentStatus.style.display = 'block';
    agentStatus.textContent = 'Thinking...';
  }

  controller = new AbortController();
  const started = performance.now();
  let tokens = 0;

  const NCM_PROMPT = `[ncm-simulation]: Simulate Next-Concept Modeling (NCM) coarse-to-fine planning. Scale passes continuously across the full 0–3 range based strictly on task complexity and input/output length: trivial chatter or brief factual lookups = 0 passes (skip NCM); straightforward tasks = 1 line (\`NCM\`); multi-step or non-trivial tasks = 2 lines (\`NCM\`, \`NCM2\`); complex logic, programming, or multi-constraint reasoning = 3 lines (\`NCM\`, \`NCM2\`, \`NCM3\`). Never jump directly from 0 to 3 for moderate tasks. When NCM is active (>0 passes), strictly emit separate plain lines using backtick-wrapped, keyword-dense semantic tokens in compressed caveman shorthand (no grammatical filler). \`NCM\` captures objective, entities, parameters, rules; \`NCM2\` captures constraints, exceptions, dependencies, state changes; \`NCM3\` captures implementation, edge cases, verification, requirements. When NCM is active, separate these prefix lines from your answer with an explicit line containing three hyphens (---) and include no NCM tokens below it. Treat the scaffold as a planning anchor, then write your complete response below \`---\`, fully obeying all other user instructions and constraints. Strict format when active: \`NCM\` \`token1\` \`token3\` \`token5\` \n \`NCM2\` \`token1\` \`token2\` \`token3\` \`token5\` \n \`NCM3\` \`token1\` \`token2\` \`token3\` \`token4\` \`token5\` \n ---\n [Complete answer]`;

  let sysContent = '';
  if (agentMode) {
    const projName = el.projectSel.options[el.projectSel.selectedIndex]?.text || 'the entire workspace';
    sysContent += `You are an AI coding agent working on the project "${projName}".
You are NOT a standard chat assistant. You have access to real tools that can read, write, and edit files, and execute PowerShell commands on the user's PC.
IMPORTANT RULES:
1. For small changes, ALWAYS use "edit_file" instead of "write_file".
2. Use "write_file" only for creating new files or completely rewriting a small file.
3. When the user asks you to run a command, test code, or check syntax, you MUST use the "run_command" tool. NEVER say "I cannot run commands".
4. Ensure all strings are properly escaped. Do not double-escape backslashes.
5. The write_file and edit_file tools will reject invalid syntax.`;
  }
  if (ncmMode) {
    if (sysContent) sysContent += '\n\n';
    sysContent += NCM_PROMPT;
  }
  const sysPrompt = sysContent ? { role: 'system', content: sysContent } : null;

  try {
    while (true) {
      const bot = { role: 'assistant', content: '', reasoning: '' };
      messages.push(bot);
      scheduleRender();

      const res = await fetch(`${location.origin}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: el.sel.value,
          stream: true,
          messages: [
            ...(sysPrompt ? [sysPrompt] : []),
            ...messages
              .slice(0, -1)
              .filter(m => (Array.isArray(m.content) ? m.content.some(p => p.content || p.text || p.image_url) : (m.content || m.reasoning || m.tool_calls)))
              .map(m => {
                if (Array.isArray(m.content)) return m;
                if (m.tool_calls) return m;
                return { role: m.role, content: m.content || '' };
              })
          ],
          tools: agentMode ? TOOLS : undefined,
          max_tokens: agentMode ? 16384 : undefined,
          temperature: agentMode ? 0.2 : undefined,
          frequency_penalty: agentMode ? 0.5 : undefined,
          presence_penalty: agentMode ? 0.5 : undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let toolCalls = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();
        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') continue;
            let json;
            try { json = JSON.parse(payload); } catch { continue; }
            const delta = json.choices?.[0]?.delta || {};
            if (delta.reasoning_content) {
              bot.reasoning += delta.reasoning_content;
              if (agentStatus) agentStatus.textContent = 'Reasoning...';
            }
            if (delta.content) {
              bot.content += delta.content;
              if (agentStatus) agentStatus.textContent = 'Writing...';
            }
            if (delta.tool_calls) {
              if (!toolCalls) toolCalls = [];
              for (const tc of delta.tool_calls) {
                if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
                if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name;
                if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments;
              }
            }
            if (json.usage?.completion_tokens) tokens = json.usage.completion_tokens;
          }
        }
        scheduleStreamUpdate(bot);
      }

      if (toolCalls && toolCalls.length > 0) {
        bot.tool_calls = toolCalls;
        for (const tc of toolCalls) {
          if (agentStatus) agentStatus.textContent = `Running ${tc.function.name}...`;
          const result = await executeTool(tc);
          messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
        }
        continue;
      }

      break;
    }
  } catch (e) {
    const lastBot = messages[messages.length - 1];
    if (lastBot && lastBot.role === 'assistant' && !lastBot.content) {
      lastBot.content = e.name === 'AbortError' ? '*[stopped]*' : `**Error:** ${e.message}`;
    }
  } finally {
    const secs = (performance.now() - started) / 1000;
    const lastBot = messages[messages.length - 1];
    if (lastBot && lastBot.role === 'assistant') {
      if (tokens) lastBot.meta = `Worked for ${secs.toFixed(1)}s · ${tokens} tokens · ${(tokens / secs).toFixed(1)} tok/s`;
      else lastBot.meta = `Worked for ${secs.toFixed(1)}s`;
    }
    if (agentStatus) agentStatus.style.display = 'none';
    if (metricsInterval) {
      clearInterval(metricsInterval);
      metricsInterval = null;
    }
    const metricsBar = document.getElementById('metrics-bar');
    if (metricsBar) metricsBar.style.display = 'none';
    
    releaseWakeLock();
    busy = false;
    el.send.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;
    updateSendState();
    render();
    persist();
    saveChat();
  }
}

el.send.addEventListener('click', () => {
  if (busy && controller) controller.abort();
  else send();
});
el.input.addEventListener('input', autoGrow);
el.input.addEventListener('focus', () => {
  setTimeout(() => {
    el.input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, 300);
});
el.input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});
el.projectSel.addEventListener('change', () => {
  if (el.projectSel.value === '__new__') {
    document.getElementById('new-project-modal').style.display = 'flex';
    document.getElementById('new-project-name').value = '';
    document.getElementById('new-project-name').focus();
  }
});

const newProjModal = document.getElementById('new-project-modal');
const newProjInput = document.getElementById('new-project-name');

document.getElementById('cancel-project').onclick = () => {
  newProjModal.style.display = 'none';
  el.projectSel.value = '';
};

document.getElementById('create-project').onclick = async () => {
  const rawName = newProjInput.value.trim();
  if (!rawName) return;
  const safeName = rawName.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g, '-');
  try {
    const res = await fetch('/api/projects/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    newProjModal.style.display = 'none';
    await loadProjects();
    el.projectSel.value = 'local-' + safeName;
  } catch (e) {
    alert('Error creating project: ' + e.message);
  }
};

el.wakeBtn.onclick = () => {
  document.getElementById('wake-modal').style.display = 'flex';
};
document.getElementById('close-wake-modal').onclick = () => {
  document.getElementById('wake-modal').style.display = 'none';
};

el.hibernateBtn.onclick = async () => {
  if (confirm('Put the PC into hibernation?')) {
    try {
      await fetch('/api/hibernate', { method: 'POST' });
      setStatus('PC is hibernating...', false);
    } catch (e) {
      alert('Failed to hibernate: ' + e.message);
    }
  }
};

el.ncmBtn.onchange = () => {
  ncmMode = el.ncmBtn.checked;
};
el.agentBtn.onclick = () => {
  agentMode = !agentMode;
  el.agentBtn.style.color = agentMode ? 'var(--primary)' : 'var(--text-muted)';
  el.projectSel.style.display = agentMode ? 'block' : 'none';
};
el.newChat.addEventListener('click', () => {
  if (confirm('Start a new chat?')) {
    messages = [];
    allowAllTools = false;
    chatId = new Date().toISOString().replace(/[:.]/g, '-');
    localStorage.setItem('chatId', chatId);
    render();
    persist();
  }
});
el.sel.addEventListener('change', persist);

let currentDir = '';

async function loadDir(dir) {
  currentDir = dir;
  const res = await fetch(`/api/files?dir=${encodeURIComponent(dir)}`);
  const files = await res.json();
  const list = document.getElementById('file-list');
  list.innerHTML = '';
  
  if (dir) {
    const upBtn = document.createElement('div');
    upBtn.className = 'file-item';
    upBtn.innerHTML = '📁 ..';
    upBtn.onclick = () => { const parts = dir.split('/'); parts.pop(); loadDir(parts.join('/')); };
    list.appendChild(upBtn);
  }
  
  for (const f of files) {
    const elItem = document.createElement('div');
    elItem.className = 'file-item';
    elItem.innerHTML = f.isDir ? `📁 ${f.name}` : `📄 ${f.name}`;
    elItem.onclick = async () => {
      if (f.isDir) {
        loadDir(dir ? dir + '/' + f.name : f.name);
      } else {
        document.getElementById('file-modal').style.display = 'none';
        const fileRes = await fetch(`/api/file?path=${encodeURIComponent(dir ? dir + '/' + f.name : f.name)}`);
        const content = await fileRes.text();
        currentAttachments.push({ type: 'text', data: content, name: f.name });
        updateAttachmentsUI();
        el.input.value = '';
      }
    };
    list.appendChild(elItem);
  }
}

document.getElementById('project-btn').onclick = () => {
  document.getElementById('file-modal').style.display = 'flex';
  loadDir('');
};
document.getElementById('close-modal').onclick = () => {
  document.getElementById('file-modal').style.display = 'none';
};

el.mediaBtn.onclick = () => el.fileInput.click();
el.fileInput.onchange = (e) => { if (e.target.files.length) handleFiles(e.target.files); e.target.value = ''; };

render();
loadModels();
loadProjects();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.error);
  });
}