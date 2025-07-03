let sessionId = localStorage.getItem('sessionId') || crypto.randomUUID();
localStorage.setItem('sessionId', sessionId);
let ws = null;
let partnerId = null;

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
}
function showChat() {
    mainScreen.style.display = 'none';
    chatScreen.style.display = '';
    msgInput.value = '';
    messagesDiv.innerHTML = '';
    setSendEnabled(false);
}
function addMsg(text, from) {
    const div = document.createElement('div');
    div.className = from;
    div.textContent = (from === 'me' ? 'Вы: ' : 'Собеседник: ') + text;
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
function connectWS() {
    ws = new WebSocket(`ws://${location.host}/ws/${sessionId}`);
    ws.onopen = () => {
        addSysMsg('Поиск собеседника...');
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
            addSysMsg('Ожидание собеседника...');
            setSendEnabled(false);
        } else if (data.type === 'message') {
            addMsg(data.text, data.from === 'stranger' ? 'stranger' : 'me');
        } else if (data.type === 'left') {
            addSysMsg('Собеседник покинул чат.');
            setSendEnabled(false);
        }
    };
    ws.onclose = () => {
        addSysMsg('Соединение потеряно.');
        setSendEnabled(false);
    };
}
startBtn.onclick = () => {
    showChat();
    connectWS();
};
sendBtn.onclick = () => {
    const text = msgInput.value.trim();
    if (text && ws && ws.readyState === 1) {
        ws.send(JSON.stringify({type: 'message', text}));
        addMsg(text, 'me');
        msgInput.value = '';
    }
};
msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn.onclick();
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
showMain(); 