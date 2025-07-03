const sessionId = sessionStorage.getItem('sessionId') || crypto.randomUUID();
sessionStorage.setItem('sessionId', sessionId);
let ws = null;
let partnerId = null;
let typingTimeout = null;
let typingSentAt = 0;

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
const themeToggle = document.getElementById('theme-toggle');

const formatTime = date => date.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
const clearMessages = () => { messagesDiv.innerHTML = ''; };
const scrollMessages = () => { messagesDiv.scrollTop = messagesDiv.scrollHeight; };

const setSendEnabled = enabled => {
    sendBtn.disabled = !enabled;
    msgInput.disabled = !enabled;
};
const showMain = () => {
    mainScreen.style.display = '';
    chatScreen.style.display = 'none';
    msgInput.value = '';
    clearMessages();
    partnerId = null;
    setSendEnabled(false);
    registerSession();
};
const showChat = () => {
    mainScreen.style.display = 'none';
    chatScreen.style.display = '';
    msgInput.value = '';
    clearMessages();
    setSendEnabled(false);
    registerSession();
};
const addMsg = (text, from, time) => {
    const div = document.createElement('div');
    div.className = from;
    const msgTime = time || formatTime(new Date());
    div.innerHTML = `<span class="msg-text">${text}</span><span class="msg-time">${msgTime}</span>`;
    messagesDiv.appendChild(div);
    scrollMessages();
    showNotification('Новое сообщение', text);
};
const addSysMsg = text => {
    const div = document.createElement('div');
    div.className = 'sys';
    div.textContent = text;
    messagesDiv.appendChild(div);
    scrollMessages();
};
const showLoaderWithText = text => {
    messagesDiv.innerHTML = `<div class="sys" style="margin-bottom:18px;">${text}</div><div class="loader"><div class="loader-circle"></div></div>`;
};
const hideLoader = () => {
    const loader = messagesDiv.querySelector('.loader');
    if (loader) loader.remove();
};

const showTypingIndicator = () => {
    let indicator = document.getElementById('typing-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'typing-indicator';
        indicator.className = 'typing-indicator';
        indicator.innerHTML = '<span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span> собеседник печатает...';
        messagesDiv.appendChild(indicator);
        scrollMessages();
    }
};
const hideTypingIndicator = () => {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
};
const showNewPartnerBtn = () => {
    // Удаляем старую динамическую кнопку, если есть
    let btn = document.getElementById('new-btn-dynamic');
    if (btn) btn.remove();
    // Создаём новую кнопку
    btn = document.createElement('button');
    btn.id = 'new-btn-dynamic';
    btn.className = 'new-btn';
    btn.textContent = 'новый собеседник';
    btn.onclick = () => {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'new'}));
        clearMessages();
        showLoaderWithText('Поиск нового собеседника...');
        setSendEnabled(false);
    };
    btn.style.display = 'block';
    btn.style.margin = '24px auto 0 auto';
    messagesDiv.appendChild(btn);
    scrollMessages();
};

const getWsUrl = (sessionId) => {
    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${wsProtocol}://${location.host}/ws/${sessionId}`;
};

const connectWS = () => {
    if (ws && ws.readyState === 1) return;
    ws = new WebSocket(getWsUrl(sessionId));
    ws.onopen = () => {
        showLoaderWithText('Поиск собеседника...');
        setSendEnabled(false);
    };
    ws.onmessage = e => {
        const data = JSON.parse(e.data);
        if (data.type === 'matched') {
            partnerId = data.partner;
            clearMessages();
            addSysMsg('Собеседник найден!');
            setSendEnabled(true);
            matchAudio.play();
            stopWaitingTimer();
            showNotification('Собеседник найден!', 'Вы подключены к чату.');
        } else if (data.type === 'waiting') {
            showLoaderWithText('Ожидание собеседника...');
            startWaitingTimer();
            setSendEnabled(false);
        } else if (data.type === 'message') {
            addMsg(data.text, data.from === 'stranger' ? 'stranger' : 'me', formatTime(new Date()));
            hideTypingIndicator();
            notifyAudio.play();
        } else if (data.type === 'left') {
            addSysMsg('Собеседник покинул чат.');
            setSendEnabled(false);
            showNewPartnerBtn();
            hideTypingIndicator();
            leftAudio.play();
            stopWaitingTimer();
        } else if (data.type === 'typing') {
            showTypingIndicator();
            if (typingTimeout) clearTimeout(typingTimeout);
            typingTimeout = setTimeout(hideTypingIndicator, 2500);
        }
    };
    ws.onerror = err => {
        addSysMsg('Ошибка соединения. Попробуйте обновить страницу.');
        setSendEnabled(false);
        showNewPartnerBtn();
    };
    ws.onclose = () => {
        addSysMsg('Соединение потеряно.');
        setSendEnabled(false);
        hideTypingIndicator();
        showNewPartnerBtn();
    };
};

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
    const now = Date.now();
    if (ws && ws.readyState === 1 && now - typingSentAt > 700) {
        ws.send(JSON.stringify({type: 'typing'}));
        typingSentAt = now;
    }
});
leaveBtn.onclick = () => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'leave'}));
    ws.close();
    showMain();
};
messagesDiv.addEventListener('click', e => {
    if (e.target && e.target.id === 'new-btn') {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'new'}));
        clearMessages();
        showLoaderWithText('Поиск нового собеседника...');
        setSendEnabled(false);
    }
});

const updateOnline = () => {
    fetch('/online')
        .then(r => r.json())
        .then(data => {
            document.getElementById('online-main').textContent = 'онлайн: ' + data.online;
            document.getElementById('online-chat').textContent = 'онлайн: ' + data.online;
        });
};
setInterval(updateOnline, 10000);
updateOnline();

const registerSession = () => {
    fetch('/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({session_id: sessionId})
    });
};
registerSession();

const closeBtn = document.getElementById('close-btn');
if (closeBtn) {
    closeBtn.onclick = () => {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({type: 'leave'}));
        ws.close();
        showMain();
    };
}

// --- Тема (тёмная/светлая) с автосохранением ---
function setTheme(dark) {
    document.body.classList.toggle('dark-theme', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    themeToggle.classList.toggle('active', dark);
}
function getSavedTheme() {
    return localStorage.getItem('theme') === 'dark';
}
// При загрузке страницы применяем сохранённую тему
setTheme(getSavedTheme());
themeToggle.onclick = () => {
    setTheme(!document.body.classList.contains('dark-theme'));
};

// Добавляем элемент Audio для уведомления
const notifyAudio = new Audio('/static/media/notify.mp3');

// Добавляем элемент Audio для уведомления о найденном собеседнике
const matchAudio = new Audio('/static/media/match.mp3');

// Добавляем элемент Audio для уведомления о выходе собеседника
const leftAudio = new Audio('/static/media/left.mp3');

// --- Таймер ожидания ---
let waitingTimer = null;
let waitingStart = null;
let waitingTimerElem = null;

function startWaitingTimer() {
    // Удаляем старый таймер, если есть
    stopWaitingTimer();
    // Добавляем текст ожидания и таймер в messages
    waitingTimerElem = document.createElement('div');
    waitingTimerElem.id = 'waiting-timer';
    waitingTimerElem.style.textAlign = 'center';
    waitingTimerElem.style.color = '#888';
    waitingTimerElem.style.marginTop = '10px';
    waitingTimerElem.innerHTML = 'Ожидание собеседника...<br>Ожидание: <span id="waiting-seconds">0</span> сек.';
    messagesDiv.innerHTML = '';
    messagesDiv.appendChild(waitingTimerElem);
    waitingStart = Date.now();
    waitingTimer = setInterval(() => {
        const seconds = Math.floor((Date.now() - waitingStart) / 1000);
        const secSpan = document.getElementById('waiting-seconds');
        if (secSpan) secSpan.textContent = seconds;
    }, 1000);
}

function stopWaitingTimer() {
    if (waitingTimer) clearInterval(waitingTimer);
    waitingTimer = null;
    if (waitingTimerElem && waitingTimerElem.parentNode) {
        waitingTimerElem.parentNode.removeChild(waitingTimerElem);
    }
    waitingTimerElem = null;
}
// --- Конец таймера ожидания ---

// --- Push-уведомления ---
function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
        new Notification(title, { body });
    }
}
// Запрашиваем разрешение на уведомления при загрузке страницы
requestNotificationPermission();

showMain();

window.addEventListener('beforeunload', function () {
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({type: 'leave'}));
        ws.close();
    }
}); 