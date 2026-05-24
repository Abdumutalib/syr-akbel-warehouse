from pydantic import BaseModel, Field

class LocationSchema(BaseModel):
    """Мижоз ёки ҳайдовчидан келадиган геолокация маълумоти тузилмаси"""
    latitude: float = Field(..., ge=-90, le=90, description="Кенглик")
    longitude: float = Field(..., ge=-180, le=180, description="Узунлик")
    user_id: int = Field(..., description="Телеграм ёки тизимдаги фойдаланувчи ID си")
