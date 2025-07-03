let sessionId = localStorage.getItem('sessionId') || crypto.randomUUID();
localStorage.setItem('sessionId', sessionId);
let ws = null;
let partnerId = null;
let typingTimeout = null;

const mainScreen = document.getElementById('main-screen');
const chatScreen = document.getElementById('chat-screen');
const startBtn = document.getElementById('start-btn');
const sendBtn = document.getElementById('send-btn');
const leaveBtn = document.getElementById('leave-btn');
const newBtn = document.getElementById('new-btn');
const msgInput = document.getElementById('msg-input');
const messagesDiv = document.getElementById('messages');
const onlineMain = document.getElementById('online-main');
const onlineChat = document.getElementById('online-chat');
const themeSwitcher = document.getElementById('theme-switcher');

function setSendEnabled(enabled) {
    sendBtn.disabled = !enabled;
    msgInput.disabled = !enabled;
}

function showMain() {
    mainScreen.style.display = '';
    chatScreen.style.display = 'none';
    msgInput.value = '';
    messagesDiv.innerHTML = '';
    partnerId = null;
    setSendEnabled(false);
    registerSession();
    setThemeToggleHandler();
}
function showChat() {
    mainScreen.style.display = 'none';
    chatScreen.style.display = '';
    msgInput.value = '';
    messagesDiv.innerHTML = '';
    setSendEnabled(false);
    setCloseBtnHandler();
}
function formatTime(date) {
    return date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}
function addMsg(text, from, time) {
    const div = document.createElement('div');
    div.className = from;
    const msgTime = time || formatTime(new Date());
    div.innerHTML = `<span class="msg-text">${text}</span><span class="msg-time">${msgTime}</span>`;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
function addSysMsg(text) {
    const div = document.createElement('div');
    div.className = 'sys';
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
function showLoaderWithText(text) {
    messagesDiv.innerHTML = `<div class="sys" style="margin-bottom:18px;">${text}</div><div class="loader"><div class="loader-circle"></div></div>`;
}
function hideLoader() {
    const loader = messagesDiv.querySelector('.loader');
    if (loader) loader.remove();
}
function showTypingIndicator() {
    let indicator = document.getElementById('typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
        messagesDiv.appendChild(indicator);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
}
function hideTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
}
function connectWS() {
    ws = new WebSocket(`ws://${location.host}/ws/${sessionId}`);
    ws.onopen = () => {
        showLoaderWithText('Поиск собеседника...');
        setSendEnabled(false);
    };
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        if (data.type === 'matched') {
            partnerId = data.partner;
            messagesDiv.innerHTML = '';
            addSysMsg('Собеседник найден!');
            setSendEnabled(true);
        } else if (data.type === 'waiting') {
            showLoaderWithText('Ожидание собеседника...');
            setSendEnabled(false);
        } else if (data.type === 'message') {
            addMsg(data.text, data.from === 'stranger' ? 'stranger' : 'me', formatTime(new Date()));
            hideTypingIndicator();
        } else if (data.type === 'left') {
            addSysMsg('Собеседник покинул чат.');
            setSendEnabled(false);
            showNewPartnerBtn();
            hideTypingIndicator();
        } else if (data.type === 'typing') {
            showTypingIndicator();
            if (typingTimeout) clearTimeout(typingTimeout);
            typingTimeout = setTimeout(hideTypingIndicator, 2500);
        }
    };
    ws.onclose = () => {
        addSysMsg('Соединение потеряно.');
        setSendEnabled(false);
        hideTypingIndicator();
    };
}
startBtn.onclick = () => {
    showChat();
    connectWS();
};
sendBtn.onclick = () => {
    const text = msgInput.value.trim();
    if (text && ws && ws.readyState === 1) {
        const now = formatTime(new Date());
        ws.send(JSON.stringify({type: 'message', text}));
        addMsg(text, 'me', now);
        msgInput.value = '';
    }
};
msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn.onclick();
});
msgInput.addEventListener('input', () => {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({type: 'typing'}));
    }
});
leaveBtn.onclick = () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'leave'}));
    ws.close();
    showMain();
};
newBtn.onclick = () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'new'}));
    messagesDiv.innerHTML = '';
    addSysMsg('Поиск нового собеседника...');
    setSendEnabled(false);
};
function showNewPartnerBtn() {
    messagesDiv.innerHTML += '<div style="text-align:center;margin:24px 0;"><button id="new-btn" class="new-btn">Новый собеседник</button></div>';
    const newBtn = document.getElementById('new-btn');
    newBtn.onclick = () => {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'new'}));
        messagesDiv.innerHTML = '';
        showLoaderWithText('Поиск нового собеседника...');
        setSendEnabled(false);
    };
}
function updateOnline() {
    fetch('/online').then(r=>r.json()).then(d=>{
        onlineMain.textContent = 'онлайн: ' + d.online;
        onlineChat.textContent = 'онлайн: ' + d.online;
    });
}
setInterval(updateOnline, 3000);
updateOnline();
function registerSession() {
    fetch('/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({session_id: sessionId})
    });
}
registerSession();

function setCloseBtnHandler() {
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'leave'}));
            ws.close();
            showMain();
        };
    }
}

function setThemeToggleHandler() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    let isDark = document.body.classList.contains('dark-theme');
    function setTheme(dark) {
        isDark = dark;
        document.body.classList.toggle('dark-theme', dark);
        themeToggle.classList.toggle('active', dark);
    }
    themeToggle.onclick = () => setTheme(!isDark);
}

showMain(); 