(function () {
  const CUSTOMER_DIRECTORY_URL = "/api/warehouse/customers";
  const CUSTOMER_DIRECTORY_SESSION_KEYS = [
    "warehouse-browser-session:credentials",
    "warehouse-seller-session:credentials",
  ];
  const CUSTOMER_DIRECTORY_PASSWORD_KEYS = [
    "warehouse-staff-password",
    "warehouse-seller-password",
    "warehouse-accountant-password",
    "warehouse-admin-password",
  ];

  const NAV_ITEMS = [
    {
      label: "Admin panel",
      href: "/warehouse/admin",
      isVisible(profile) {
        return !profile || profile.role === "admin";
      },
      isActive(pathname) {
        return pathname === "/warehouse/admin";
      },
    },
    {
      label: "Admin naqd",
      href: "/warehouse/admin/cash",
      isVisible(profile) {
        return hasPermission(profile, "cash");
      },
      isActive(pathname) {
        return pathname === "/warehouse/admin/cash";
      },
    },
    {
      label: "Admin o'tkazma",
      href: "/warehouse/admin/transfer",
      isVisible(profile) {
        return hasPermission(profile, "transfer");
      },
      isActive(pathname) {
        return pathname === "/warehouse/admin/transfer";
      },
    },
    {
      label: "Umumiy hisobot",
      href: "/warehouse/ledger",
      isVisible(profile) {
        return hasPermission(profile, ["cash", "transfer"]);
      },
      isActive(pathname) {
        return pathname === "/warehouse/ledger";
      },
    },
    {
      label: "Sotuvchi",
      href: "/warehouse/seller",
      isVisible(profile) {
        return hasPermission(profile, "seller");
      },
      isActive(pathname) {
        return pathname === "/warehouse/seller";
      },
    },
    {
      label: "Mijozlar",
      href: "/warehouse/customers",
      isVisible(profile) {
        return hasPermission(profile, "customers");
      },
      isActive(pathname) {
        return pathname === "/warehouse/customers" || pathname.startsWith("/warehouse/customers/");
      },
    },
    {
      label: "Buyurtmalar",
      href: "/warehouse/orders",
      isVisible() {
        return true;
      },
      isActive(pathname) {
        return pathname === "/warehouse/orders";
      },
    },
    {
      label: "Naqd savdo yozish",
      href: "/warehouse/seller/sale/cash",
      isVisible(profile) {
        return hasPermission(profile, "seller");
      },
      isActive(pathname) {
        return pathname === "/warehouse/seller/sale/cash";
      },
    },
    {
      label: "O'tkazma savdo yozish",
      href: "/warehouse/seller/sale/transfer",
      isVisible(profile) {
        return hasPermission(profile, ["seller", "transfer"]);
      },
      isActive(pathname) {
        return pathname === "/warehouse/seller/sale/transfer";
      },
    },
  ];

  let customerDirectoryState = [];
  let customerDirectoryLoaded = false;
  let customerDirectoryLoading = null;

  function readSearchParam(name) {
    if (typeof window.getWarehouseSearchParam === "function") {
      return window.getWarehouseSearchParam(name, window.location.search);
    }
    const source = String(window.location.search || "");
    const query = source.charAt(0) === "?" ? source.slice(1) : source;
    if (!query) {
      return "";
    }
    const parts = query.split("&");
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) {
        continue;
      }
      const separatorIndex = part.indexOf("=");
      const rawKey = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
      if (decodeURIComponent(rawKey) !== name) {
        continue;
      }
      const rawValue = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : "";
      return decodeURIComponent(String(rawValue).replace(/\+/g, " "));
    }
    return "";
  }

  function getOperatorProfile() {
    if (typeof window.getWarehouseOperatorProfile === "function") {
      return window.getWarehouseOperatorProfile();
    }
    return null;
  }

  function hasPermission(profile, requiredPermissions) {
    if (!profile) {
      return true;
    }
    if (profile.role === "admin") {
      return true;
    }
    const permissions = Array.isArray(profile.permissions) ? profile.permissions : [];
    const required = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];
    return required.some((entry) => permissions.includes(entry));
  }

  function buildHref(path) {
    const access = readSearchParam("access");
    if (!access) {
      return path;
    }
    return `${path}${path.indexOf("?") >= 0 ? "&" : "?"}access=${encodeURIComponent(access)}`;
  }

  function buildApiUrl(path) {
    return typeof path === "string" && path.startsWith("/api/")
      ? `/warehouse/api${path.slice("/api".length)}`
      : path;
  }

  function readStoredSessionCredentials() {
    for (const key of CUSTOMER_DIRECTORY_SESSION_KEYS) {
      try {
        const raw = window.sessionStorage.getItem(key);
        if (!raw) {
          continue;
        }
        const parsed = JSON.parse(raw);
        const username = String(parsed && parsed.username ? parsed.username : "").trim();
        const password = String(parsed && parsed.password ? parsed.password : "");
        if (username && password) {
          return { username, password };
        }
      } catch (error) {}
    }
    return null;
  }

  function readStoredPassword() {
    for (const key of CUSTOMER_DIRECTORY_PASSWORD_KEYS) {
      const password = window.localStorage.getItem(key);
      if (password) {
        return password;
      }
    }
    return "";
  }

  function readCurrentCredentials() {
    const sessionCredentials = readStoredSessionCredentials();
    if (sessionCredentials) {
      return sessionCredentials;
    }
    const usernameEl = document.getElementById("username");
    const passwordEl = document.getElementById("password");
    const usernameValue = usernameEl && typeof usernameEl.value === "string" ? usernameEl.value : "";
    const passwordValue = passwordEl && typeof passwordEl.value === "string" ? passwordEl.value : "";
    const username = String(usernameValue || window.localStorage.getItem("warehouse-staff-username") || window.localStorage.getItem("warehouse-seller-username") || window.localStorage.getItem("warehouse-accountant-username") || window.localStorage.getItem("warehouse-admin-username") || "").trim();
    const password = String(passwordValue || readStoredPassword() || "");
    if (!username || !password) {
      return null;
    }
    return { username, password };
  }

  function buildCustomerDirectoryHeaders() {
    const access = readSearchParam("access") || window.localStorage.getItem("warehouse-access-token") || "";
    if (access) {
      return { "X-Warehouse-Access": access };
    }
    const credentials = readCurrentCredentials();
    if (!credentials) {
      return null;
    }
    return {
      Authorization: `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`,
    };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;");
  }

  function uniqueCustomerNames(customer) {
    const rawNames = customer && Array.isArray(customer.fullNames) && customer.fullNames.length
      ? customer.fullNames
      : [customer && customer.fullName ? customer.fullName : ""];
    const names = [];
    rawNames.map((entry) => String(entry || "").trim()).filter(Boolean).forEach((entry) => {
      if (names.indexOf(entry) === -1) {
        names.push(entry);
      }
    });
    return names;
  }

  function findCustomerMatch(query) {
    const normalizedQuery = String(query || "").trim().toLocaleLowerCase("ru");
    if (!normalizedQuery) {
      return null;
    }
    return customerDirectoryState.find((customer) => {
      const values = [
        ...uniqueCustomerNames(customer),
        customer.organizationName,
        customer.taxId,
        ...(Array.isArray(customer.phones) ? customer.phones : []),
      ].filter(Boolean).map((entry) => String(entry).toLocaleLowerCase("ru"));
      return values.some((entry) => entry === normalizedQuery || entry.includes(normalizedQuery));
    }) || null;
  }

  async function loadCustomerDirectory() {
    if (customerDirectoryLoading) {
      return customerDirectoryLoading;
    }
    const headers = buildCustomerDirectoryHeaders();
    if (!headers) {
      customerDirectoryLoaded = false;
      customerDirectoryState = [];
      return [];
    }
    customerDirectoryLoading = fetch(buildApiUrl(CUSTOMER_DIRECTORY_URL), { headers })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || "Mijozlar ro'yxati olinmadi");
        }
        customerDirectoryState = Array.isArray(data.customers) ? data.customers : [];
        customerDirectoryLoaded = true;
        return customerDirectoryState;
      })
      .catch(() => {
        customerDirectoryLoaded = false;
        customerDirectoryState = [];
        return [];
      })
      .then((result) => {
        customerDirectoryLoading = null;
        return result;
      }, (error) => {
        customerDirectoryLoading = null;
        throw error;
      });
    return customerDirectoryLoading;
  }

  function injectStyles() {
    if (document.getElementById("warehouse-top-nav-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "warehouse-top-nav-style";
    style.textContent = `
      .warehouse-global-nav {
        margin-bottom: 18px;
        padding: 10px;
        border: 1px solid var(--line, #e4d4bf);
        border-radius: 22px;
        background: var(--panel, #fffdf9);
        background: color-mix(in srgb, var(--panel, #fffdf9) 95%, white 5%);
        box-shadow: 0 14px 30px rgba(53, 34, 15, 0.05);
      }

      .warehouse-global-nav__list {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .warehouse-global-nav__row {
        display: flex;
        gap: 14px;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
      }

      .warehouse-global-nav__tools {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }

      .warehouse-global-nav__search {
        min-width: min(320px, 100%);
        flex: 1 1 280px;
      }

      .warehouse-global-nav__search label {
        display: block;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--muted, #6d665d);
        margin-bottom: 6px;
      }

      .warehouse-global-nav__search-row {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .warehouse-global-nav__input {
        width: 100%;
        min-height: 46px;
        padding: 11px 14px;
        border-radius: 999px;
        border: 1px solid var(--line, #e4d4bf);
        background: #fff;
        color: var(--ink, #18140f);
        font: inherit;
      }

      .warehouse-global-nav__link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 46px;
        padding: 11px 16px;
        border-radius: 999px;
        border: 1px solid var(--line, #e4d4bf);
        background: #fff;
        color: var(--ink, #18140f);
        text-decoration: none;
        font: inherit;
        transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease;
      }

      .warehouse-global-nav__link:hover {
        transform: translateY(-1px);
      }

      .warehouse-global-nav__link.is-active {
        background: var(--accent, #8c4f24);
        border-color: var(--accent, #8c4f24);
        color: #fff;
      }

      @media (max-width: 640px) {
        .warehouse-global-nav__row {
          flex-direction: column;
          align-items: stretch;
        }

        .warehouse-global-nav__tools,
        .warehouse-global-nav__list {
          display: grid;
          grid-template-columns: 1fr;
        }

        .warehouse-global-nav__search-row {
          display: grid;
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function renderNav() {
    const shell = document.querySelector(".shell");
    if (!shell) {
      return;
    }

    injectStyles();

    const existing = document.querySelector(".warehouse-global-nav");
    if (existing) {
      existing.remove();
    }

    const profile = getOperatorProfile();

    const nav = document.createElement("section");
    nav.className = "warehouse-global-nav";

    const row = document.createElement("div");
    row.className = "warehouse-global-nav__row";

    const list = document.createElement("div");
    list.className = "warehouse-global-nav__list";

    for (const item of NAV_ITEMS) {
      if (typeof item.isVisible === "function" && !item.isVisible(profile)) {
        continue;
      }
      const link = document.createElement("a");
      link.className = "warehouse-global-nav__link";
      if (item.isActive(window.location.pathname)) {
        link.classList.add("is-active");
      }
      link.href = buildHref(item.href);
      link.textContent = item.label;
      list.appendChild(link);
    }

    const tools = document.createElement("div");
    tools.className = "warehouse-global-nav__tools";

    const search = document.createElement("div");
    search.className = "warehouse-global-nav__search";

    const searchLabel = document.createElement("label");
    searchLabel.htmlFor = "warehouse-global-customer-search";
    searchLabel.textContent = "Mijoz qidirish";

    const searchRow = document.createElement("div");
    searchRow.className = "warehouse-global-nav__search-row";

    const searchInput = document.createElement("input");
    searchInput.id = "warehouse-global-customer-search";
    searchInput.className = "warehouse-global-nav__input";
    searchInput.setAttribute("list", "warehouse-global-customer-options");
    searchInput.placeholder = customerDirectoryLoaded
      ? "Ism, tashkilot, INN yoki telefon yozing"
      : "Avval kirib, keyin mijoz qidiring";
    searchInput.disabled = !customerDirectoryState.length;

    const datalist = document.createElement("datalist");
    datalist.id = "warehouse-global-customer-options";
    const customerOptions = [];
    customerDirectoryState.forEach((customer) => {
      const extra = [customer.organizationName, customer.taxId ? `INN ${customer.taxId}` : null]
        .filter(Boolean)
        .join(" · ");
      uniqueCustomerNames(customer).forEach((name) => {
        customerOptions.push(`<option value="${escapeHtml(name)}" label="${escapeHtml(extra)}"></option>`);
      });
    });
    datalist.innerHTML = customerOptions.join("");

    const searchButton = document.createElement("button");
    searchButton.type = "button";
    searchButton.className = "warehouse-global-nav__link";
    searchButton.textContent = "Ochish";
    searchButton.disabled = !customerDirectoryState.length;

    const openCustomer = () => {
      const customer = findCustomerMatch(searchInput.value);
      if (!customer) {
        searchInput.setCustomValidity("Mijoz topilmadi");
        searchInput.reportValidity();
        return;
      }
      searchInput.setCustomValidity("");
      window.location.href = buildHref(`/warehouse/customers/${customer.id}`);
    };

    searchInput.addEventListener("input", () => {
      searchInput.setCustomValidity("");
    });
    searchInput.addEventListener("change", () => {
      if (findCustomerMatch(searchInput.value)) {
        searchInput.setCustomValidity("");
      }
    });
    searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        openCustomer();
      }
    });
    searchButton.addEventListener("click", openCustomer);

    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchButton);
    search.appendChild(searchLabel);
    search.appendChild(searchRow);
    search.appendChild(datalist);
    tools.appendChild(search);

    row.appendChild(list);
    row.appendChild(tools);
    nav.appendChild(row);

    const hero = shell.querySelector(".hero");
    if (hero) {
      shell.insertBefore(nav, hero);
      return;
    }

    shell.prepend(nav);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderNav, { once: true });
  } else {
    renderNav();
  }

  window.addEventListener("warehouse:operator-profile-changed", renderNav);
  window.addEventListener("warehouse:operator-profile-changed", () => {
    loadCustomerDirectory().then(() => renderNav());
  });
  loadCustomerDirectory().then(() => renderNav());
})();