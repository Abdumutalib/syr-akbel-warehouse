(function() {
  if (window.warehouseMapInitialized) return;
  window.warehouseMapInitialized = true;

  // Leaflet kiritish (agar yo'q bo'lsa)
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = '/warehouse/leaflet.css';
    document.head.appendChild(link);
  }

  // HTML Modal yaratish
  const modalHtml = `
  <div id="locationMapModal" class="modal-backdrop" style="z-index: 9999;">
    <div class="modal-content" style="width: 100%; max-width: 600px; padding: 0; display: flex; flex-direction: column; height: 80vh;">
      <div class="modal-header" style="padding: 16px;">
        <h2 style="margin: 0; font-size: 18px;">Lokatsiyani tanlang</h2>
        <button class="modal-close" id="closeLocationMapModal" type="button">&times;</button>
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
      <div style="padding: 16px;">
        <button id="confirmLocationMap" style="width: 100%;">Shu manzilni tasdiqlash</button>
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

  function loadLeafletAndInitMap(lat, lng) {
    const loader = document.getElementById('locationMapLoader');
    if (loader) loader.style.display = 'flex';
    if (window.L) {
      initMap(lat, lng);
      return;
    }
    const script = document.createElement('script');
    script.src = '/warehouse/leaflet.js';
    script.onload = () => initMap(lat, lng);
    script.onerror = () => { if(loader) loader.innerText = 'Xarita yuklashda xatolik yuz berdi. Internetni tekshiring.'; };
    document.head.appendChild(script);
  }

  function initMap(lat, lng) {
    const loader = document.getElementById('locationMapLoader');
    if (loader) loader.style.display = 'none';
    if (!map) {
      map = L.map('locationMapContainer', { zoomControl: false }).setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
      }).addTo(map);
      L.control.zoom({ position: 'bottomleft' }).addTo(map);
    } else {
      map.setView([lat, lng], 15);
      setTimeout(() => {
        map.invalidateSize();
      }, 10);
    }
  }

  window.openLocationMap = function(inputId) {
    targetInputId = inputId;
    modalEl.classList.add('active');
    
    // Default location: Toshkent
    let lat = 41.2995;
    let lng = 69.2401;

    // Harakatlanib turgan input qiymatini tahlil qilish
    const inputEl = document.getElementById(inputId);
    if (inputEl && inputEl.value) {
      const val = inputEl.value;
      const match = val.match(/q=([\d.]+),([\d.]+)/); // Google Maps link format
      if (match) {
        lat = parseFloat(match[1]);
        lng = parseFloat(match[2]);
      } else {
        const latLngMatch = val.match(/^([\d.]+),\s*([\d.]+)$/); // "41.2995, 69.2401" format
        if (latLngMatch) {
          lat = parseFloat(latLngMatch[1]);
          lng = parseFloat(latLngMatch[2]);
        }
      }
    }

    loadLeafletAndInitMap(lat, lng);
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
        if (map) {
          map.setView([pos.coords.latitude, pos.coords.longitude], 17);
        }
        findMyLocBtn.style.opacity = '1';
      }, (err) => {
        alert("Geolokatsiyani aniqlash imkonsiz.");
        findMyLocBtn.style.opacity = '1';
      });
    }
  });

})();
