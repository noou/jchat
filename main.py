import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict
from collections import deque
import json
from datetime import datetime, timedelta
import os
import asyncio
from starlette.middleware.base import BaseHTTPMiddleware
import logging

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# Очередь ожидания и активные чаты
waiting_queue = deque()
active_chats: Dict[str, WebSocket] = {}
session_pairs: Dict[str, str] = {}  # session_id -> partner_id
online_sessions: set = set()

# --- Для минимизации памяти ---
last_active = {}
INACTIVITY_TIMEOUT = timedelta(minutes=1)

LOG_PATH = os.path.join(os.path.dirname(__file__), 'logs', 'chat_log.jsonl')
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

# Надёжное логирование сообщений
def log_chat_message(chat_id, from_id, text, ip):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "chat_id": chat_id,
                "from": from_id,
                "text": text,
                "timestamp": datetime.utcnow().isoformat(),
                "ip": ip
            }, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[LOGGING ERROR] {e}")

class SuppressOnlineLogMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if request.url.path == "/online":
            logger = logging.getLogger("uvicorn.access")
            level = logger.level
            logger.setLevel(logging.ERROR)
            response = await call_next(request)
            logger.setLevel(level)
            return response
        return await call_next(request)

app.add_middleware(SuppressOnlineLogMiddleware)

class OnlineFilter(logging.Filter):
    def filter(self, record):
        return "/online" not in record.getMessage()

logging.getLogger("uvicorn.access").addFilter(OnlineFilter())

@app.get("/")
def root():
    return FileResponse("static/index.html")

@app.get("/online")
def get_online():
    return {"online": len(online_sessions)}

@app.post("/register")
async def register(request: Request):
    data = await request.json()
    session_id = data.get("session_id")
    if session_id:
        online_sessions.add(session_id)
    return {"ok": True, "online": len(online_sessions)}

@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    online_sessions.add(session_id)
    last_active[session_id] = datetime.utcnow()
    try:
        # Если пользователь уже в чате, переподключение
        if session_id in session_pairs:
            partner_id = session_pairs[session_id]
            active_chats[session_id] = websocket
            await websocket.send_json({"type": "matched", "partner": partner_id})
        else:
            # Поиск собеседника
            partner_id = None
            while waiting_queue:
                candidate = waiting_queue.popleft()
                if candidate != session_id:
                    partner_id = candidate
                    break
            if partner_id:
                session_pairs[session_id] = partner_id
                session_pairs[partner_id] = session_id
                active_chats[session_id] = websocket
                # Уведомить обе стороны
                partner_ws = active_chats.get(partner_id)
                if partner_ws:
                    await partner_ws.send_json({"type": "matched", "partner": session_id})
                await websocket.send_json({"type": "matched", "partner": partner_id})
            else:
                waiting_queue.append(session_id)
                active_chats[session_id] = websocket
                await websocket.send_json({"type": "waiting"})
        # Основной цикл обмена
        while True:
            try:
                data = await websocket.receive_json()
                last_active[session_id] = datetime.utcnow()
            except Exception as e:
                print(f"[WS RECEIVE ERROR] {e}")
                break
            msg_type = data.get("type")
            if msg_type == "message":
                last_active[session_id] = datetime.utcnow()
                partner_id = session_pairs.get(session_id)
                if partner_id and partner_id in active_chats:
                    # Ограничение длины сообщения
                    text = data["text"][:500]
                    chat_id = "-".join(sorted([session_id, partner_id]))
                    log_chat_message(chat_id, session_id, text, websocket.client.host)
                    try:
                        await active_chats[partner_id].send_json({"type": "message", "from": "stranger", "text": text})
                    except Exception as e:
                        print(f"[WS SEND ERROR] {e}")
            elif msg_type == "typing":
                last_active[session_id] = datetime.utcnow()
                partner_id = session_pairs.get(session_id)
                if partner_id and partner_id in active_chats:
                    try:
                        await active_chats[partner_id].send_json({"type": "typing"})
                    except Exception as e:
                        print(f"[WS SEND ERROR] {e}")
            elif msg_type == "leave":
                last_active[session_id] = datetime.utcnow()
                await handle_leave(session_id)
                break
            elif msg_type == "new":
                last_active[session_id] = datetime.utcnow()
                await handle_leave(session_id)
                # Новый поиск собеседника
                partner_id = None
                while waiting_queue:
                    candidate = waiting_queue.popleft()
                    if candidate != session_id:
                        partner_id = candidate
                        break
                if partner_id:
                    session_pairs[session_id] = partner_id
                    session_pairs[partner_id] = session_id
                    await websocket.send_json({"type": "matched", "partner": partner_id})
                    partner_ws = active_chats.get(partner_id)
                    if partner_ws:
                        await partner_ws.send_json({"type": "matched", "partner": session_id})
                else:
                    waiting_queue.append(session_id)
                    await websocket.send_json({"type": "waiting"})
    except WebSocketDisconnect:
        await handle_leave(session_id)
    finally:
        online_sessions.discard(session_id)
        active_chats.pop(session_id, None)

# --- Вспомогательные функции ---
def get_partner(session_id):
    return session_pairs.get(session_id)

async def handle_leave(session_id):
    partner_id = session_pairs.pop(session_id, None)
    if partner_id:
        session_pairs.pop(partner_id, None)
        ws = active_chats.get(partner_id)
        if ws:
            try:
                await ws.send_json({"type": "left"})
            except Exception as e:
                print(f"[WS SEND ERROR] {e}")
    # Удалить из очереди, если был в ожидании
    try:
        waiting_queue.remove(session_id)
    except ValueError:
        pass

async def cleanup_inactive_sessions():
    while True:
        now = datetime.utcnow()
        inactive = [sid for sid, t in last_active.items() if now - t > INACTIVITY_TIMEOUT]
        for sid in inactive:
            print(f"[CLEANUP] Удаляю неактивную сессию {sid}")
            last_active.pop(sid, None)
            online_sessions.discard(sid)
            active_chats.pop(sid, None)
            partner_id = session_pairs.pop(sid, None)
            if partner_id:
                session_pairs.pop(partner_id, None)
        await asyncio.sleep(300)  # Проверять каждые 5 минут

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(cleanup_inactive_sessions()) 