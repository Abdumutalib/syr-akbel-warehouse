(function() {
  if (window.warehouseMapInitialized) return;
  window.warehouseMapInitialized = true;

  // MapLibre CSS kiritish
  if (!document.getElementById('maplibre-css')) {
    const link = document.createElement('link');
    link.id = 'maplibre-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/maplibre-gl@4.x/dist/maplibre-gl.css';
    document.head.appendChild(link);
  }

  // HTML Modal yaratish
  const modalHtml = `
  <style>
    #locationMapModal {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 9999;
      align-items: center; justify-content: center;
    }
    #locationMapModal.active {
      display: flex;
    }
    #locationMapModal .modal-content {
      background: #fff;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
  </style>
  <div id="locationMapModal" style="z-index: 9999;">
    <div class="modal-content" style="width: 100%; max-width: 600px; padding: 0; display: flex; flex-direction: column; height: 85dvh; max-height: 85vh; border-radius: 16px; overflow: hidden; background: #fff;">
      <div class="modal-header" style="padding: 16px; flex-shrink: 0; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #eee;">
        <h2 style="margin: 0; font-size: 18px;">Lokatsiyani tanlang</h2>
        <button class="modal-close" id="closeLocationMapModal" type="button" style="background: transparent; border: 0; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">&times;</button>
      </div>
      <div style="flex: 1; position: relative; background: #eee;">
        <div id="locationMapLoader" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; z-index: 500; color: #666; background: #eee; font-weight: bold;">Xarita yuklanmoqda...</div>
        <div id="locationMapContainer" style="width: 100%; height: 100%;"></div>
        <!-- Markaziy pin (Telegram uslubida) -->
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -100%); z-index: 1000; pointer-events: none;">
          <span style="font-size: 40px; filter: drop-shadow(0px 3px 3px rgba(0,0,0,0.4));">📍</span>
        </div>
        <!-- Geolokatsiyani aniqlash tugmasi -->
        <button id="findMyLocationBtn" type="button" style="position: absolute; bottom: 20px; right: 10px; z-index: 1000; padding: 10px; border-radius: 50%; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; background: white; border: 2px solid rgba(0,0,0,0.2); cursor: pointer; color: #333;" title="Mening joylashuvim">
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>
        </button>
      </div>
      <div style="padding: 16px; flex-shrink: 0; background: white; z-index: 1001;">
        <button id="confirmLocationMap" style="width: 100%; padding: 12px; border-radius: 12px; background: #224847; color: white; border: none; font-size: 16px; cursor: pointer;">Shu manzilni tasdiqlash</button>
      </div>
    </div>
  </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHtml);

  const modalEl = document.getElementById('locationMapModal');
  const closeBtn = document.getElementById('closeLocationMapModal');
  const confirmBtn = document.getElementById('confirmLocationMap');
  const findMyLocBtn = document.getElementById('findMyLocationBtn');
  
  let map = null;
  let targetInputId = null;

  function loadMapLibreAndInitMap(lat, lng) {
    const loader = document.getElementById('locationMapLoader');
    if (loader) loader.style.display = 'flex';
    if (window.maplibregl) {
      initMap(lat, lng);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/maplibre-gl@4.x/dist/maplibre-gl.js';
    script.onload = () => initMap(lat, lng);
    script.onerror = () => { if(loader) loader.innerText = 'Xarita yuklashda xatolik yuz berdi. Internetni tekshiring.'; };
    document.head.appendChild(script);
  }

  function initMap(lat, lng) {
    const loader = document.getElementById('locationMapLoader');
    if (loader) loader.style.display = 'none';
    if (!map) {
      map = new maplibregl.Map({
        container: 'locationMapContainer',
        style: {
          'version': 8,
          'sources': {
            'raster-tiles': {
              'type': 'raster',
              'tiles': [
                'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
                'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'
              ],
              'tileSize': 256,
              'attribution': '© OpenStreetMap contributors © CARTO'
            }
          },
          'layers': [{
            'id': 'simple-tiles',
            'type': 'raster',
            'source': 'raster-tiles',
            'minzoom': 0,
            'maxzoom': 22
          }]
        },
        center: [lng, lat],
        zoom: 15
      });
      map.addControl(new maplibregl.NavigationControl(), 'bottom-left');
    } else {
      map.setCenter([lng, lat]);
      map.setZoom(15);
    }
    // Asynchronous call required because the modal display:flex might not have been painted yet
    setTimeout(() => {
      if (map) map.resize();
    }, 150);
  }

  window.openLocationMap = function(inputId) {
    targetInputId = inputId;
    modalEl.classList.add('active');
    
    // Default location: Toshkent
    let lat = 41.311081;
    let lng = 69.240562;

    // Harakatlanib turgan input qiymatini tahlil qilish
    const inputEl = document.getElementById(inputId);
    let hasExisting = false;
    if (inputEl && inputEl.value) {
      const val = inputEl.value;
      const match = val.match(/q=([\d.]+),([\d.]+)/); // Google Maps link format
      if (match) {
        lat = parseFloat(match[1]);
        lng = parseFloat(match[2]);
        hasExisting = true;
      } else {
        const latLngMatch = val.match(/^([\d.]+),\s*([\d.]+)$/); // "41.2995, 69.2401" format
        if (latLngMatch) {
          lat = parseFloat(latLngMatch[1]);
          lng = parseFloat(latLngMatch[2]);
          hasExisting = true;
        }
      }
    }

    if (!hasExisting) {
      const cachedLat = localStorage.getItem('last_akbel_lat');
      const cachedLng = localStorage.getItem('last_akbel_lng');
      if (cachedLat && cachedLng) {
        lat = parseFloat(cachedLat);
        lng = parseFloat(cachedLng);
      }
    }

    loadMapLibreAndInitMap(lat, lng);

    if (!hasExisting && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const currentLat = pos.coords.latitude;
        const currentLng = pos.coords.longitude;
        localStorage.setItem('last_akbel_lat', currentLat);
        localStorage.setItem('last_akbel_lng', currentLng);
        if (map) {
          map.setCenter([currentLng, currentLat]);
          map.setZoom(17);
        }
      }, (error) => {
        console.warn("GPS aniqlashda xatolik, keshdagi ma'lumot qoldirildi:", error.message);
      }, { enableHighAccuracy: true, timeout: 5000 });
    }
  };

  function closeModal() {
    modalEl.classList.remove('active');
  }

  closeBtn.addEventListener('click', closeModal);
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeModal();
  });

  confirmBtn.addEventListener('click', () => {
    if (!map || !targetInputId) return;
    const center = map.getCenter();
    const link = `https://maps.google.com/?q=${center.lat.toFixed(6)},${center.lng.toFixed(6)}`;
    
    const inputEl = document.getElementById(targetInputId);
    if (inputEl) {
      inputEl.value = link;
    }
    closeModal();
  });

  findMyLocBtn.addEventListener('click', () => {
    if (navigator.geolocation) {
      findMyLocBtn.style.opacity = '0.5';
      navigator.geolocation.getCurrentPosition((pos) => {
        const currentLat = pos.coords.latitude;
        const currentLng = pos.coords.longitude;
        localStorage.setItem('last_akbel_lat', currentLat);
        localStorage.setItem('last_akbel_lng', currentLng);
        if (map) {
          map.setCenter([currentLng, currentLat]);
          map.setZoom(17);
        }
        findMyLocBtn.style.opacity = '1';
      }, (err) => {
        alert("Geolokatsiyani aniqlash imkonsiz.");
        findMyLocBtn.style.opacity = '1';
      }, { enableHighAccuracy: true, timeout: 5000 });
    }
  });

})();
