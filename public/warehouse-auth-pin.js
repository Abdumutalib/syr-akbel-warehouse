(function () {
  const VAULT_KEY = 'warehouse-pin-vault-v2';
  const LEGACY_VAULT_KEY = 'warehouse-pin-vault-v1';
  const OPERATOR_PROFILE_KEY = 'warehouse-operator-profile-v1';
  const WAREHOUSE_STORAGE_PREFIX = 'warehouse-';
  const STAFF_PERMISSION_KEYS = ['seller', 'customers', 'cash', 'transfer'];
  const LEGACY_USERNAME_KEYS = [
    'warehouse-admin-username',
    'warehouse-seller-username',
    'warehouse-accountant-username',
    'warehouse-staff-username',
  ];
  const LEGACY_PASSWORD_KEYS = [
    'warehouse-admin-password',
    'warehouse-seller-password',
    'warehouse-accountant-password',
    'warehouse-staff-password',
  ];
  const cryptoApi = window.crypto || window.msCrypto || null;
  const encoder = typeof window.TextEncoder === 'function' ? new window.TextEncoder() : null;
  const decoder = typeof window.TextDecoder === 'function' ? new window.TextDecoder() : null;

  function isWarehouseStorageKey(key) {
    return String(key || '').indexOf(WAREHOUSE_STORAGE_PREFIX) === 0;
  }

  function enforceEphemeralWarehouseStorage() {
    if (!window.localStorage || !window.sessionStorage) {
      return;
    }
    const local = window.localStorage;
    const session = window.sessionStorage;

    // Move any previously persisted warehouse keys into session storage, then purge disk-backed copies.
    try {
      const keysToMove = [];
      for (let index = 0; index < local.length; index += 1) {
        const key = local.key(index);
        if (isWarehouseStorageKey(key)) {
          keysToMove.push(key);
        }
      }
      keysToMove.forEach((key) => {
        try {
          const value = local.getItem(key);
          if (value != null) {
            session.setItem(key, value);
          }
        } catch (error) {}
        try {
          local.removeItem(key);
        } catch (error) {}
      });
    } catch (error) {}

    const nativeSetItem = local.setItem.bind(local);
    const nativeGetItem = local.getItem.bind(local);
    const nativeRemoveItem = local.removeItem.bind(local);

    try {
      local.setItem = function setItemPatched(key, value) {
        if (isWarehouseStorageKey(key)) {
          try {
            session.setItem(String(key), String(value));
          } catch (error) {}
          try {
            nativeRemoveItem(String(key));
          } catch (error) {}
          return;
        }
        nativeSetItem(key, value);
      };

      local.getItem = function getItemPatched(key) {
        if (isWarehouseStorageKey(key)) {
          try {
            const fromSession = session.getItem(String(key));
            if (fromSession != null) {
              return fromSession;
            }
          } catch (error) {}
          try {
            const fromLocal = nativeGetItem(String(key));
            if (fromLocal != null) {
              session.setItem(String(key), fromLocal);
              nativeRemoveItem(String(key));
            }
            return fromLocal;
          } catch (error) {
            return null;
          }
        }
        return nativeGetItem(key);
      };

      local.removeItem = function removeItemPatched(key) {
        if (isWarehouseStorageKey(key)) {
          try {
            session.removeItem(String(key));
          } catch (error) {}
        }
        nativeRemoveItem(key);
      };
    } catch (error) {}
  }

  enforceEphemeralWarehouseStorage();

  function encodeUtf8(value) {
    const normalized = String(value || '');
    if (encoder) {
      return encoder.encode(normalized);
    }
    const binary = unescape(encodeURIComponent(normalized));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function decodeUtf8(bytes) {
    if (decoder) {
      return decoder.decode(bytes);
    }
    let binary = '';
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return decodeURIComponent(escape(binary));
  }

  function supportsSecurePinStorage() {
    return Boolean(cryptoApi && cryptoApi.subtle && typeof cryptoApi.getRandomValues === 'function');
  }

  function ensureSecurePinStorage() {
    if (!supportsSecurePinStorage()) {
      throw new Error('Bu telefonda PIN saqlash ishlamaydi. Username va password bilan kiring.');
    }
  }

  function readSearchParam(name, search) {
    const source = String(search || '');
    const query = source.charAt(0) === '?' ? source.slice(1) : source;
    if (!query) {
      return '';
    }
    const pairs = query.split('&');
    for (let index = 0; index < pairs.length; index += 1) {
      const part = pairs[index];
      if (!part) {
        continue;
      }
      const separatorIndex = part.indexOf('=');
      const rawKey = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
      if (decodeURIComponent(rawKey) !== name) {
        continue;
      }
      const rawValue = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '';
      return decodeURIComponent(String(rawValue).replace(/\+/g, ' '));
    }
    return '';
  }

  function getLastPathSegment(pathname) {
    const segments = String(pathname || '').split('/');
    for (let index = segments.length - 1; index >= 0; index -= 1) {
      if (segments[index]) {
        return segments[index];
      }
    }
    return '';
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      for (let offset = 0; offset < chunk.length; offset += 1) {
        binary += String.fromCharCode(chunk[offset]);
      }
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function normalizeUsername(username) {
    return String(username || '').trim().toLowerCase();
  }

  function emptyStore() {
    return {
      version: 2,
      lastUsername: '',
      profiles: {},
    };
  }

  function normalizeStore(value) {
    if (!value || typeof value !== 'object') {
      return emptyStore();
    }
    const profiles = value.profiles && typeof value.profiles === 'object' ? value.profiles : {};
    return {
      version: 2,
      lastUsername: String(value.lastUsername || ''),
      profiles,
    };
  }

  function readLegacyVault() {
    try {
      const raw = localStorage.getItem(LEGACY_VAULT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeVault(value) {
    localStorage.setItem(VAULT_KEY, JSON.stringify(value));
  }

  function migrateLegacyVault() {
    const existing = localStorage.getItem(VAULT_KEY);
    if (existing) {
      return normalizeStore(JSON.parse(existing));
    }
    const legacy = readLegacyVault();
    if (!legacy || !legacy.username || !legacy.ciphertext) {
      return emptyStore();
    }
    const usernameKey = normalizeUsername(legacy.username);
    const store = {
      version: 2,
      lastUsername: legacy.username,
      profiles: {
        [usernameKey]: {
          version: 1,
          username: legacy.username,
          createdAt: legacy.createdAt || new Date().toISOString(),
          salt: legacy.salt,
          iv: legacy.iv,
          ciphertext: legacy.ciphertext,
        },
      },
    };
    writeVault(store);
    localStorage.removeItem(LEGACY_VAULT_KEY);
    return store;
  }

  function readVaultStore() {
    try {
      return migrateLegacyVault();
    } catch (error) {
      return emptyStore();
    }
  }

  function writeVaultStore(value) {
    writeVault(normalizeStore(value));
  }

  function getProfileForUsername(store, username) {
    const usernameKey = normalizeUsername(username);
    if (!usernameKey) {
      return null;
    }
    if (!store || !store.profiles || typeof store.profiles !== 'object') {
      return null;
    }
    return store.profiles[usernameKey] || null;
  }

  function getSoleProfile(store) {
    if (!store || !store.profiles || typeof store.profiles !== 'object') {
      return null;
    }
    const keys = Object.keys(store.profiles);
    return keys.length === 1 ? store.profiles[keys[0]] : null;
  }

  function hasProfiles(store) {
    return Boolean(store && store.profiles && typeof store.profiles === 'object' && Object.keys(store.profiles).length > 0);
  }

  function resolveProfileForCurrentUser(store, username) {
    return getProfileForUsername(store, username) || (!normalizeUsername(username) ? getSoleProfile(store) : null);
  }

  function clearLegacyPasswords() {
    LEGACY_PASSWORD_KEYS.forEach((key) => localStorage.removeItem(key));
  }

  function clearLegacyUsernames() {
    LEGACY_USERNAME_KEYS.forEach((key) => localStorage.removeItem(key));
  }

  function normalizePin(pin) {
    return String(pin || '').trim();
  }

  function ensurePin(pin) {
    if (!/^\d{4,6}$/.test(pin)) {
      throw new Error('PIN 4-6 ta raqam bo\'lishi kerak.');
    }
    return pin;
  }

  async function deriveKey(pin, salt) {
    ensureSecurePinStorage();
    const keyMaterial = await cryptoApi.subtle.importKey('raw', encodeUtf8(pin), 'PBKDF2', false, ['deriveKey']);
    return cryptoApi.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 120000,
        hash: 'SHA-256',
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256,
      },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptCredentials(pin, credentials) {
    ensureSecurePinStorage();
    const salt = cryptoApi.getRandomValues(new Uint8Array(16));
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pin, salt);
    const payload = encodeUtf8(JSON.stringify(credentials));
    const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
    return {
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    };
  }

  async function decryptCredentials(pin, vault) {
    if (!vault) {
      throw new Error('Saqlangan PIN topilmadi.');
    }
    try {
      const salt = base64ToBytes(vault.salt);
      const iv = base64ToBytes(vault.iv);
      const ciphertext = base64ToBytes(vault.ciphertext);
      const key = await deriveKey(pin, salt);
      const payload = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
      return JSON.parse(decodeUtf8(new Uint8Array(payload)));
    } catch (error) {
      throw new Error('PIN noto\'g\'ri yoki saqlangan ma\'lumot buzilgan.');
    }
  }

  function createWarehousePinAuth(options) {
    const {
      usernameEl,
      passwordEl,
      pinEl,
      setStatus,
      sessionKey = 'warehouse-auth-session',
      initialUsername = '',
      initialPassword = '',
      lockedMessage = 'PIN saqlangan. PIN bilan kiring yoki username/passwordni qayta yozing.',
      credentialsMessage = 'Username va password kiriting.',
    } = options;

    const sessionAuthKey = `${sessionKey}:credentials`;

    function readSessionCredentials() {
      try {
        const raw = sessionStorage.getItem(sessionAuthKey);
        return raw ? JSON.parse(raw) : null;
      } catch (error) {
        return null;
      }
    }

    function writeSessionCredentials(value) {
      sessionStorage.setItem(sessionAuthKey, JSON.stringify(value));
    }

    function clearSessionCredentials() {
      sessionStorage.removeItem(sessionAuthKey);
    }

    const sessionCredentials = readSessionCredentials();
    const vaultStore = readVaultStore();
    clearLegacyUsernames();
    clearLegacyPasswords();
    usernameEl.value = initialUsername || '';
    passwordEl.value = initialPassword || '';

    if (hasProfiles(vaultStore) && typeof setStatus === 'function') {
      setStatus(lockedMessage);
    }

    async function rememberFromCredentials() {
      const pin = normalizePin(pinEl ? pinEl.value : '');
      if (!pin) {
        return false;
      }
      ensureSecurePinStorage();
      ensurePin(pin);
      const username = usernameEl.value.trim();
      const password = passwordEl.value;
      if (!username || !password) {
        throw new Error(credentialsMessage);
      }
      const encrypted = await encryptCredentials(pin, { username, password });
      const store = readVaultStore();
      store.lastUsername = username;
      store.profiles[normalizeUsername(username)] = {
        version: 1,
        username,
        createdAt: new Date().toISOString(),
        ...encrypted,
      };
      writeVaultStore(store);
      clearLegacyPasswords();
      if (typeof setStatus === 'function') {
        setStatus('PIN saqlandi. Endi shu user uchun PIN bilan kirishingiz mumkin.');
      }
      return true;
    }

    function markSessionActive(credentials) {
      const username = credentials && credentials.username ? credentials.username : usernameEl.value.trim();
      const password = credentials && credentials.password ? credentials.password : passwordEl.value;
      if (!username || !password) {
        return false;
      }
      writeSessionCredentials({ username, password });
      return true;
    }

    function clearSession() {
      clearSessionCredentials();
    }

    function hasActiveSession() {
      const session = readSessionCredentials();
      return Boolean(session && session.username && session.password);
    }

    function getAuthCredentials() {
      const session = readSessionCredentials();
      if (session && session.username && session.password) {
        return session;
      }
      const username = usernameEl.value.trim();
      const password = passwordEl.value;
      if (!username || !password) {
        return null;
      }
      return { username, password };
    }

    async function unlockWithPin() {
      ensureSecurePinStorage();
      const pin = ensurePin(normalizePin(pinEl ? pinEl.value : ''));
      const store = readVaultStore();
      const profile = resolveProfileForCurrentUser(store, usernameEl.value.trim());
      if (!profile) {
        throw new Error('Avval username kiriting yoki shu user uchun PIN saqlang.');
      }
      const credentials = await decryptCredentials(pin, profile);
      usernameEl.value = credentials.username || '';
      passwordEl.value = credentials.password || '';
      store.lastUsername = credentials.username || store.lastUsername;
      writeVaultStore(store);
      if (typeof setStatus === 'function') {
        setStatus('PIN orqali kirildi.');
      }
      return credentials;
    }

    function clearPin() {
      const store = readVaultStore();
      const username = usernameEl.value.trim();
      const profile = resolveProfileForCurrentUser(store, username);
      if (!profile) {
        if (typeof setStatus === 'function') {
          setStatus('Saqlangan PIN yo\'q.');
        }
        return false;
      }
      delete store.profiles[normalizeUsername(profile.username)];
      if (store.lastUsername && normalizeUsername(store.lastUsername) === normalizeUsername(profile.username)) {
        store.lastUsername = username || '';
      }
      if (hasProfiles(store)) {
        writeVaultStore(store);
      } else {
        localStorage.removeItem(VAULT_KEY);
      }
      if (pinEl) {
        pinEl.value = '';
      }
      if (typeof setStatus === 'function') {
        setStatus(`${profile.username} uchun PIN o\'chirildi. Endi username/password bilan kiring.`);
      }
      return true;
    }

    function syncPasswordStorage(password, storageKey) {
      void password;
      clearLegacyUsernames();
      clearLegacyPasswords();
      if (storageKey) {
        localStorage.removeItem(storageKey);
      }
    }

    function hasPin() {
      return hasProfiles(readVaultStore());
    }

    return {
      canUsePin() {
        return supportsSecurePinStorage();
      },
      hasPin,
      hasActiveSession,
      getAuthCredentials,
      markSessionActive,
      clearSession,
      rememberFromCredentials,
      unlockWithPin,
      clearPin,
      syncPasswordStorage,
    };
  }

  function createWarehouseAuthUi(options) {
    const {
      pinAuth,
      accessToken = '',
      authPanelEl,
      sessionNoticeEl,
      titleEl,
      passwordGroupEl,
      saveAuthButtonEl,
      unlockPinButtonEl,
      clearPinButtonEl,
      showLoginButtonEl,
      hintEl,
      fullTitle,
      pinTitle = 'PIN bilan kirish',
      fullHint,
      pinHint,
      activeHint = 'Kirish tasdiqlandi.',
    } = options;

    let forceFullLogin = false;

    function isSessionActive() {
      return Boolean(accessToken) || pinAuth.hasActiveSession();
    }

    function markAuthenticated(credentials) {
      if (!accessToken) {
        pinAuth.markSessionActive(credentials);
      }
      forceFullLogin = false;
      render();
    }

    function showFullLogin() {
      forceFullLogin = true;
      render();
    }

    function render() {
      const pinAvailable = pinAuth.hasPin();
      const sessionActive = isSessionActive();
      const pinOnlyMode = !sessionActive && pinAvailable && !forceFullLogin && !accessToken;

      if (authPanelEl) {
        authPanelEl.hidden = sessionActive;
      }
      if (sessionNoticeEl) {
        sessionNoticeEl.hidden = !sessionActive;
        sessionNoticeEl.textContent = sessionActive ? activeHint : '';
      }
      if (titleEl) {
        titleEl.textContent = pinOnlyMode ? pinTitle : fullTitle;
      }
      if (passwordGroupEl) {
        passwordGroupEl.hidden = pinOnlyMode;
      }
      if (saveAuthButtonEl) {
        saveAuthButtonEl.hidden = pinOnlyMode;
      }
      if (unlockPinButtonEl) {
        unlockPinButtonEl.hidden = sessionActive || !pinAvailable;
      }
      if (clearPinButtonEl) {
        clearPinButtonEl.hidden = sessionActive || !pinAvailable;
      }
      if (showLoginButtonEl) {
        showLoginButtonEl.hidden = sessionActive || !pinOnlyMode;
      }
      if (hintEl) {
        hintEl.textContent = sessionActive ? '' : (pinOnlyMode ? pinHint : fullHint);
      }
    }

    return {
      isSessionActive,
      markAuthenticated,
      showFullLogin,
      render,
    };
  }

  function normalizeOperatorProfile(profile) {
    if (!profile || typeof profile !== 'object') {
      return null;
    }
    const role = String(profile.role || '').trim().toLowerCase();
    const permissions = Array.isArray(profile.permissions)
      ? profile.permissions
        .map((entry) => String(entry || '').trim().toLowerCase())
        .filter((entry, index, list) => STAFF_PERMISSION_KEYS.includes(entry) && list.indexOf(entry) === index)
      : [];
    return {
      kind: String(profile.kind || 'staff'),
      role,
      username: String(profile.username || ''),
      fullName: String(profile.fullName || profile.username || ''),
      permissions,
    };
  }

  function readOperatorProfile() {
    try {
      const raw = localStorage.getItem(OPERATOR_PROFILE_KEY);
      return raw ? normalizeOperatorProfile(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function dispatchOperatorProfile(profile) {
    window.dispatchEvent(new CustomEvent('warehouse:operator-profile-changed', {
      detail: { profile },
    }));
  }

  function writeOperatorProfile(profile) {
    const normalized = normalizeOperatorProfile(profile);
    if (!normalized) {
      localStorage.removeItem(OPERATOR_PROFILE_KEY);
      dispatchOperatorProfile(null);
      return null;
    }
    localStorage.setItem(OPERATOR_PROFILE_KEY, JSON.stringify(normalized));
    dispatchOperatorProfile(normalized);
    return normalized;
  }

  function clearOperatorProfile() {
    localStorage.removeItem(OPERATOR_PROFILE_KEY);
    dispatchOperatorProfile(null);
  }

  function warehouseOperatorHasPermission(profile, requiredPermissions) {
    const normalized = normalizeOperatorProfile(profile) || readOperatorProfile();
    if (!normalized) {
      return false;
    }
    if (normalized.role === 'admin') {
      return true;
    }
    const required = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];
    return required.some((entry) => normalized.permissions.includes(String(entry || '').trim().toLowerCase()));
  }

  function createWarehouseStaffSelector(options) {
    const {
      usernameEl,
      usernameGroupEl,
      label = 'Xodimlar ro\'yxati',
      permissions = [],
      manualOptionLabel = 'Admin yoki boshqa login',
      directoryUrl = '/warehouse/api/warehouse/staff-directory',
    } = options || {};

    if (!usernameEl || !usernameGroupEl) {
      return {
        load: async () => [],
        showManualLogin() {},
      };
    }

    const selectId = `${usernameEl.id || 'warehouse-username'}-staff-select`;
    const wrapper = document.createElement('div');
    const selectLabel = document.createElement('label');
    const selectEl = document.createElement('select');
    let filteredStaff = [];

    wrapper.dataset.staffSelector = 'true';
    wrapper.style.display = 'grid';
    wrapper.style.gap = '0';
    wrapper.style.marginBottom = '14px';

    selectLabel.htmlFor = selectId;
    selectLabel.textContent = label;

    selectEl.id = selectId;
    selectEl.style.display = 'block';
    selectEl.style.width = '100%';
    selectEl.style.font = 'inherit';
    selectEl.style.borderRadius = '12px';
    selectEl.style.border = '1px solid var(--line, #e4d4bf)';
    selectEl.style.background = '#fff';
    selectEl.style.padding = '12px 14px';
    selectEl.style.margin = '8px 0 0';

    wrapper.appendChild(selectLabel);
    wrapper.appendChild(selectEl);
    usernameGroupEl.parentNode.insertBefore(wrapper, usernameGroupEl);

    function matchesPermissions(entry) {
      if (!permissions.length) {
        return true;
      }
      const entryPermissions = entry && Array.isArray(entry.permissions) ? entry.permissions : [];
      return permissions.some((permission) => entryPermissions.includes(permission));
    }

    function buildOptionLabel(entry) {
      const roleLabel = entry.role === 'accountant' ? 'Buxgalter' : 'Sotuvchi';
      return `${entry.fullName} (${roleLabel})`;
    }

    function syncSelection() {
      const selected = filteredStaff.find((entry) => String(entry.id) === String(selectEl.value));
      if (selected) {
        usernameEl.value = selected.username || '';
        usernameGroupEl.hidden = true;
        return;
      }
      if (selectEl.value !== '__manual__') {
        usernameEl.value = '';
      }
      usernameGroupEl.hidden = false;
    }

    async function load() {
      try {
        const response = await fetch(directoryUrl);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || 'Xodimlar ro\'yxatini olib bo\'lmadi.');
        }
        filteredStaff = (Array.isArray(data.staff) ? data.staff : []).filter(matchesPermissions);
      } catch {
        filteredStaff = [];
      }

      if (!filteredStaff.length) {
        wrapper.hidden = true;
        usernameGroupEl.hidden = false;
        return [];
      }

      const rememberedUsername = String(usernameEl.value || '').trim().toLowerCase();
      selectEl.innerHTML = [
        `<option value="">${label}dan ўзингизни танланг</option>`,
        `<option value="__manual__">${manualOptionLabel}</option>`,
        ...filteredStaff.map((entry) => `<option value="${entry.id}">${buildOptionLabel(entry)}</option>`),
      ].join('');
      wrapper.hidden = false;

      const matched = filteredStaff.find((entry) => String(entry.username || '').trim().toLowerCase() === rememberedUsername);
      if (matched) {
        selectEl.value = String(matched.id);
      } else if (rememberedUsername) {
        selectEl.value = '__manual__';
      } else {
        selectEl.value = '';
      }
      syncSelection();
      return filteredStaff;
    }

    function showManualLogin() {
      if (!wrapper.hidden) {
        selectEl.value = '__manual__';
      }
      syncSelection();
    }

    selectEl.addEventListener('change', syncSelection);

    return {
      load,
      showManualLogin,
    };
  }

  function setupWarehouseInstallButton() {
    const ua = String(window.navigator && window.navigator.userAgent ? window.navigator.userAgent : '').toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua);
    const isSafari = isIos && /safari/.test(ua) && !/crios|fxios|edgios/.test(ua);
    const isAndroid = /android/.test(ua);
    const isLikelyMobile = isIos || isAndroid || window.innerWidth <= 900;

    function isStandalone() {
      return Boolean(
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true
      );
    }

    if (isStandalone()) {
      return;
    }

    if (!isLikelyMobile) {
      return;
    }

    let deferredPrompt = null;
    const button = document.createElement('button');
    button.type = 'button';
    button.hidden = false;
    button.textContent = 'Ilovani o\'rnatish';
    button.setAttribute('aria-label', 'Ilovani o\'rnatish');
    button.style.position = 'fixed';
    button.style.right = '14px';
    button.style.bottom = '14px';
    button.style.zIndex = '10000';
    button.style.border = '0';
    button.style.borderRadius = '999px';
    button.style.padding = '10px 14px';
    button.style.font = '600 14px/1.2 system-ui, -apple-system, Segoe UI, sans-serif';
    button.style.color = '#fff';
    button.style.background = '#7d501d';
    button.style.boxShadow = '0 8px 24px rgba(0,0,0,.2)';
    button.style.cursor = 'pointer';

    function mountButton() {
      if (!button.isConnected && document.body) {
        document.body.appendChild(button);
      }
    }

    function setVisible(visible, text) {
      mountButton();
      if (text) {
        button.textContent = text;
      }
      button.hidden = !visible;
    }

    setVisible(true, isSafari ? 'Home screenga qo\'shish' : 'Ilovani o\'rnatish');

    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredPrompt = event;
      setVisible(true, 'Ilovani o\'rnatish');
    });

    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      setVisible(false);
    });

    // Inline hint banner (no alert)
    let hintEl = null;
    function showInstallHint(msg) {
      if (!hintEl) {
        hintEl = document.createElement('div');
        hintEl.style.cssText = [
          'position:fixed', 'right:14px', 'bottom:66px', 'z-index:10001',
          'max-width:calc(100vw - 28px)', 'padding:12px 16px',
          'background:#2c1a09', 'color:#fff', 'border-radius:16px',
          'font:500 13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif',
          'box-shadow:0 8px 24px rgba(0,0,0,.3)', 'white-space:pre-line',
          'cursor:pointer',
        ].join(';');
        hintEl.setAttribute('role', 'tooltip');
        hintEl.addEventListener('click', function () {
          hintEl.remove();
          hintEl = null;
        });
        document.body.appendChild(hintEl);
      }
      hintEl.textContent = msg;
      clearTimeout(hintEl._timer);
      hintEl._timer = setTimeout(function () {
        if (hintEl) { hintEl.remove(); hintEl = null; }
      }, 7000);
    }

    button.addEventListener('click', async function () {
      if (deferredPrompt) {
        try {
          await deferredPrompt.prompt();
          await deferredPrompt.userChoice;
        } catch (error) {
        }
        deferredPrompt = null;
        setVisible(false);
        return;
      }

      if (isSafari) {
        showInstallHint('⬆ Safari pastki panelidagi "Share" (ulashish) tugmasini bosing,\nso\'ng "Add to Home Screen" ni tanlang.');
        return;
      }

      // Chrome/Edge/Samsung – try re-requesting native prompt or show quiet hint
      showInstallHint('Brauzer menyusini oching (⋮)\nva "Ilovani o\'rnatish" yoki "Add to Home screen" ni tanlang.');
    });
  }

  setupWarehouseInstallButton();

  window.createWarehousePinAuth = createWarehousePinAuth;
  window.createWarehouseAuthUi = createWarehouseAuthUi;
  window.getWarehouseOperatorProfile = readOperatorProfile;
  window.setWarehouseOperatorProfile = writeOperatorProfile;
  window.clearWarehouseOperatorProfile = clearOperatorProfile;
  window.warehouseOperatorHasPermission = warehouseOperatorHasPermission;
  window.createWarehouseStaffSelector = createWarehouseStaffSelector;
  window.getWarehouseSearchParam = function (name, search) {
    return readSearchParam(name, arguments.length > 1 ? search : window.location.search);
  };
  window.getWarehouseLastPathSegment = function (pathname) {
    return getLastPathSegment(arguments.length ? pathname : window.location.pathname);
  };
})();