import uuid
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
from collections import deque
import asyncio
import json
from datetime import datetime
import os

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

LOG_PATH = os.path.join(os.path.dirname(__file__), 'logs', 'chat_log.jsonl')
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)

def log_chat_message(chat_id, from_id, text, ip):
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "chat_id": chat_id,
            "from": from_id,
            "text": text,
            "timestamp": datetime.utcnow().isoformat(),
            "ip": ip
        }, ensure_ascii=False) + "\n")

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
    try:
        # Если пользователь уже в чате, переподключение
        if session_id in session_pairs:
            partner_id = session_pairs[session_id]
            active_chats[session_id] = websocket
            await websocket.send_json({"type": "matched", "partner": partner_id})
        else:
            # Поиск собеседника
            if waiting_queue:
                partner_id = waiting_queue.popleft()
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
        # Основной цикл
        while True:
            data = await websocket.receive_json()
            if data["type"] == "message":
                partner_id = session_pairs.get(session_id)
                if partner_id and partner_id in active_chats:
                    # Логирование сообщения
                    chat_id = "-".join(sorted([session_id, partner_id]))
                    log_chat_message(chat_id, session_id, data["text"][:500], websocket.client.host)
                    await active_chats[partner_id].send_json({"type": "message", "from": "stranger", "text": data["text"][:500]})
            elif data["type"] == "leave":
                await handle_leave(session_id)
                break
            elif data["type"] == "new":
                await handle_leave(session_id)
                # Новый поиск собеседника
                if waiting_queue:
                    partner_id = waiting_queue.popleft()
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

def get_partner(session_id):
    return session_pairs.get(session_id)

async def handle_leave(session_id):
    partner_id = session_pairs.pop(session_id, None)
    if partner_id:
        session_pairs.pop(partner_id, None)
        ws = active_chats.get(partner_id)
        if ws:
            await ws.send_json({"type": "left"})
    # Удалить из очереди, если был в ожидании
    try:
        waiting_queue.remove(session_id)
    except ValueError:
        pass 