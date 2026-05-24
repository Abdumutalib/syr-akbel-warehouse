-- Координаталарни тезкор қидириш учун GIST гео-индекси
CREATE INDEX idx_akbel_users_location ON users USING gist (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326));
