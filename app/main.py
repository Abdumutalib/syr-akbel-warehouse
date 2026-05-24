from fastapi import FastAPI, BackgroundTasks, status
from app.schemas.location import LocationSchema
from app.services.geocoding import async_reverse_geocoding

app = FastAPI(title="Akbel Warehouse Geo-Service")

@app.post("/api/v1/location/update", status_code=status.HTTP_202_ACCEPTED)
async def update_location(
    data: LocationSchema, 
    background_tasks: BackgroundTasks
):
    """
    Геолокацияни миллисонияларда қабул қилиб олувчи АПИ.
    Жуда тез ишлайди, чунки оғир вазифаларни фонга топширади.
    """
    # 1. Тезкорлик учун аввал маълумотни содда форматда базага ёки Redis кэшга ёзамиз
    # Базага ёзишда PostGIS учун ST_SetSRID(ST_MakePoint(lng, lat), 4326) ишлатилади (Гео-индекс)
    
    # 2. Оғир вазифани (Манзилни матнга айлантиришни) орқа фонга юборамиз
    background_tasks.add_task(
        async_reverse_geocoding, 
        user_id=data.user_id, 
        lat=data.latitude, 
        lng=data.longitude
    )
    
    # 3. Фойдаланувчига ёки Телеграм ботга "Қабул қилинди" (202) жавобини дарҳол қайтарамиз
    return {"status": "success", "message": "Location queued for processing"}
