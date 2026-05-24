import requests
from pydantic import BaseModel

# Телеграмдан келадиган тайёр Location тузилмаси
class TelegramLocation(BaseModel):
    longitude: float
    latitude: float

class TelegramMessage(BaseModel):
    from_user_id: int
    location: TelegramLocation

def handle_telegram_location(message: TelegramMessage):
    """
    Telegram ботга жойлашув келганда ишга тушадиган функция.
    Маълумотни бэкенд АПИ га жуда енгил JSON қилиб узатади.
    """
    # FastAPI гео-хизматининг манзили
    GEO_SERVICE_URL = "http://localhost:8000/api/v1/location/update"
    
    # Сиз яратган тизим стандартига мослаштирамиз (Промтдаги тузилмага мос)
    payload = {
        "latitude": message.location.latitude,
        "longitude": message.location.longitude,
        "user_id": message.from_user_id
    }
    
    try:
        # Тезликни йўқотмаслик учун timeout қўйилади (Агар бэкенд жавоб бермаса бот қотиб қолмайди)
        response = requests.post(GEO_SERVICE_URL, json=payload, timeout=1.5)
        return response.status_code == 202
    except requests.exceptions.RequestException:
        # Хатолик юз берса тизим тўхтамайди, кэш ёки логга ёзилади
        return False
