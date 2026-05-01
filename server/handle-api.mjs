export async function handleWarehouseApiRoute(req, res, u, apiPath, deps) {
  const {
    assertWarehouseAdmin,
    assertWarehouseOperator,
    buildDebtReply,
    buildPendingReply,
    createStaffAccessLink,
    createStaffAccount,
    createWarehouseOrder,
    createWarehouseTransaction,
    currentWarehousePricing,
    deleteCustomer,
    deleteStaffAccount,
    getCustomerDetail,
    groupCustomersByPaymentType,
    listApprovedTransactions,
    listCustomerSummaries,
    listDeletedCustomers,
    listPendingTransactions,
    listSellerCashHandoffs,
    listWarehouseOrders,
    listWarehouseReceipts,
    listStaffAccounts,
    loadWarehouse,
    normalizeApprovalPayment,
    readPostJson,
    recordApprovedSale,
    recordCustomerPayment,
    recordSellerCashHandoff,
    recordWarehouseReceipt,
    restoreDeletedCustomer,
    revokeStaffAccessLink,
    saveWarehouse,
    setCustomerSellerBalanceVisibility,
    seedWarehouseStock,
    sendApiJson,
    sendTelegramMessage,
    summarizeApprovedTransactions,
    summarizeOperatorDailyActivity,
    summarizeWarehouseReceipts,
    summarizeCustomers,
    storeWarehouseTransactionPhoto,
    storeWarehouseTransactionPhotos,
    approveTransaction,
    updateStaffAccountPermissions,
    updateWarehousePricing,
    upsertCustomer,
  } = deps;

  function serializeOperator(operator) {
    if (!operator || typeof operator !== "object") {
      return null;
    }
    const permissions = operator.role === "admin"
      ? ["seller", "customers", "cash", "transfer"]
      : (operator.authKind === "access-link" && operator.accessLink?.permission
          ? [String(operator.accessLink.permission)]
          : (Array.isArray(operator.permissions) ? operator.permissions : []));
    return {
      id: operator.id ?? null,
      kind: operator.kind || operator.authKind || "staff",
      role: operator.role || null,
      username: operator.username || "",
      fullName: operator.fullName || operator.username || "",
      permissions,
    };
  }

  function serializeStaffDirectoryEntry(entry) {
    return {
      id: entry.id,
      fullName: entry.fullName,
      username: entry.username,
      role: entry.role,
      permissions: Array.isArray(entry.permissions) ? entry.permissions : [],
    };
  }

  function serializeOrderCustomerDirectory(state) {
    return (Array.isArray(state?.users) ? state.users : [])
      .slice()
      .sort((left, right) => String(left?.fullName || "").localeCompare(String(right?.fullName || ""), "ru"))
      .map((entry) => ({
        id: entry.id,
        fullName: entry.fullName || "",
        fullNames: Array.isArray(entry.fullNames) ? entry.fullNames : [],
        organizationName: entry.organizationName || null,
        taxId: entry.taxId || null,
        phones: Array.isArray(entry.phones) ? entry.phones : [],
      }));
  }

  function serializeCustomerDirectory(state) {
    return serializeOrderCustomerDirectory(state);
  }

  function canOperatorViewCustomerBalance(operator, customer) {
    if (!operator || operator.role === "admin") {
      return true;
    }
    if (operator.role !== "seller") {
      return true;
    }
    return customer?.sellerCanViewBalance === true;
  }

  function maskCustomerSummaryForOperator(customer, operator) {
    if (canOperatorViewCustomerBalance(operator, customer)) {
      return customer;
    }
    return {
      ...customer,
      totalSales: null,
      totalPaid: null,
      cashDebt: null,
      transferDebt: null,
      currentDebt: null,
    };
  }

  function maskCustomerDetailForOperator(detail, operator) {
    if (canOperatorViewCustomerBalance(operator, detail?.customer)) {
      return {
        ...detail,
        balanceVisible: true,
      };
    }
    return {
      ...detail,
      balanceVisible: false,
      summary: {
        ...(detail.summary || {}),
        totalSales: null,
        totalPaid: null,
        cashDebt: null,
        transferDebt: null,
        currentDebt: null,
      },
    };
  }

  if (apiPath === "/api/telegram/webhook" && req.method === "POST") {
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    const payload = deps.extractTelegramMessage(body);
    if (!payload || !payload.text) {
      sendApiJson(res, 200, { ok: true, ignored: true });
      return true;
    }
    try {
      const result = createWarehouseTransaction(payload);
      await sendTelegramMessage(payload.telegramId, buildPendingReply(result));
      sendApiJson(res, 200, { ok: true, transactionId: result.transaction.id });
    } catch (e) {
      await sendTelegramMessage(
        payload.telegramId,
        "Xabar formati noto'g'ri. Misol: Ali aka 12 kg"
      );
      sendApiJson(res, 200, {
        ok: true,
        error: e.message || "Xabarni tahlil qilib bo'lmadi",
      });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/business-message" && req.method === "POST") {
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const result = createWarehouseTransaction(body);
      sendApiJson(res, 201, {
        ok: true,
        transactionId: result.transaction.id,
        user: result.user.fullName,
        amountKg: result.transaction.amountKg,
        totalPrice: result.transaction.totalPrice,
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Xabar formati noto'g'ri" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/pending" && req.method === "GET") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const state = loadWarehouse();
    const pricing = currentWarehousePricing(state);
    const receipts = listWarehouseReceipts(state);
    sendApiJson(res, 200, {
      ok: true,
      pending: listPendingTransactions(state, pricing),
      receipts: receipts.slice(0, 10),
      receiptSummary: summarizeWarehouseReceipts(receipts),
      stockKg: state.warehouse.currentStockKg,
      pricing,
    });
    return true;
  }

  if (apiPath === "/api/warehouse/stock-receipts" && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const receipt = recordWarehouseReceipt(state, body);
      saveWarehouse(state);
      sendApiJson(res, 201, {
        ok: true,
        receipt,
        receipts: listWarehouseReceipts(state).slice(0, 10),
        stockKg: state.warehouse.currentStockKg,
        pricing: currentWarehousePricing(state),
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Qabulni saqlab bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/staff-directory" && req.method === "GET") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const state = loadWarehouse();
    sendApiJson(res, 200, {
      ok: true,
      staff: listStaffAccounts(state).map(serializeStaffDirectoryEntry),
      adminEnabled: true,
    });
    return true;
  }

  if (apiPath === "/api/warehouse/customers" && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      realm: "warehouse-seller",
      permission: "seller",
      message: "Mijoz qo'shish uchun sotuvchi ruxsati kerak",
    });
    if (!operator) {
      return true;
    }
    const state = loadWarehouse();
    const pricing = currentWarehousePricing(state);
    const customers = listCustomerSummaries(state, pricing).map((customer) => maskCustomerSummaryForOperator(customer, operator));
    sendApiJson(res, 200, {
      ok: true,
      customers,
      summary: summarizeCustomers(customers),
      dailySummary: summarizeOperatorDailyActivity(state, operator, { pricing }),
      stockKg: state.warehouse.currentStockKg,
      pricing,
      operator: serializeOperator(operator),
    });
    return true;
  }

  if (apiPath === "/api/warehouse/customer-catalog" && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      permission: "customers",
      message: "Mijozlar sahifasi uchun ruxsat kerak",
    });
    if (!operator) {
      return true;
    }
    const state = loadWarehouse();
    const catalog = groupCustomersByPaymentType(state, currentWarehousePricing(state));
    sendApiJson(res, 200, {
      ok: true,
      ...catalog,
      operator: serializeOperator(operator),
    });
    return true;
  }

  if (apiPath === "/api/warehouse/orders" && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      message: "Zakazlar sahifasi uchun kirish kerak",
    });
    if (!operator) {
      return true;
    }
    const state = loadWarehouse();
    sendApiJson(res, 200, {
      ok: true,
      orders: listWarehouseOrders(state),
      operator: serializeOperator(operator),
    });
    return true;
  }

  if (apiPath === "/api/warehouse/order-customer-directory" && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      message: "Zakaz uchun mijozlar ro'yxatini olishda kirish kerak",
    });
    if (!operator) {
      return true;
    }
    const state = loadWarehouse();
    sendApiJson(res, 200, {
      ok: true,
      customers: serializeOrderCustomerDirectory(state),
      operator: serializeOperator(operator),
    });
    return true;
  }

  if (apiPath === "/api/warehouse/customer-directory" && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      message: "Mijozlar ro'yxatini olishda kirish kerak",
    });
    if (!operator) {
      return true;
    }
    const state = loadWarehouse();
    sendApiJson(res, 200, {
      ok: true,
      customers: serializeCustomerDirectory(state),
      operator: serializeOperator(operator),
    });
    return true;
  }

  if (apiPath === "/api/warehouse/orders" && req.method === "POST") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      message: "Zakaz yozish uchun kirish kerak",
    });
    if (!operator) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const order = createWarehouseOrder(state, body, operator);
      saveWarehouse(state);
      sendApiJson(res, 201, {
        ok: true,
        order,
        operator: serializeOperator(operator),
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Zakazni saqlab bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/customers" && req.method === "POST") {
    const operator = assertWarehouseOperator(req, res, {
      roles: ["seller"],
      allowAdmin: true,
      realm: "warehouse-seller",
      message: "Mijoz qo'shish учун sotuvchi yoki admin ruxsati kerak",
    });
    if (!operator) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const payload = {
        ...body,
      };
      if (
        operator.role !== "admin" &&
        (Object.prototype.hasOwnProperty.call(payload, "customCashPricePerKg") ||
          Object.prototype.hasOwnProperty.call(payload, "customTransferPricePerKg"))
      ) {
        sendApiJson(res, 403, { error: "Mijozning maxsus narxini faqat admin o'zgartira oladi" });
        return true;
      }
      delete payload.sellerCanViewBalance;
      const customer = upsertCustomer(state, payload);
      saveWarehouse(state);
      sendApiJson(res, 201, { ok: true, customer });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Mijozni saqlab bo'lmadi" });
    }
    return true;
  }

  const customerDetailMatch = apiPath.match(/^\/api\/warehouse\/customers\/(\d+)$/);
  if (customerDetailMatch && req.method === "DELETE") {
    if (!assertWarehouseOperator(req, res, {
      roles: ["seller"],
      allowAdmin: true,
      realm: "warehouse-seller",
      message: "Mijozni o'chirish учун sotuvchi yoki admin ruxsati kerak",
    })) {
      return true;
    }
    try {
      const state = loadWarehouse();
      const result = deleteCustomer(state, Number(customerDetailMatch[1]));
      saveWarehouse(state);
      sendApiJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendApiJson(res, 404, { error: e.message || "Mijozni o'chirib bo'lmadi" });
    }
    return true;
  }

  if (customerDetailMatch && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      permission: "customers",
      message: "Mijoz sahifasi uchun ruxsat kerak",
    });
    if (!operator) {
      return true;
    }
    try {
      const state = loadWarehouse();
      const detail = maskCustomerDetailForOperator(
        getCustomerDetail(state, Number(customerDetailMatch[1]), currentWarehousePricing(state)),
        operator
      );
      sendApiJson(res, 200, {
        ok: true,
        ...detail,
        operator: serializeOperator(operator),
      });
    } catch (e) {
      sendApiJson(res, 404, { error: e.message || "Mijoz topilmadi" });
    }
    return true;
  }

  const customerBalanceVisibilityMatch = apiPath.match(/^\/api\/warehouse\/customers\/(\d+)\/seller-balance-visibility$/);
  if (customerBalanceVisibilityMatch && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const customer = setCustomerSellerBalanceVisibility(state, Number(customerBalanceVisibilityMatch[1]), body.visible);
      saveWarehouse(state);
      sendApiJson(res, 200, {
        ok: true,
        customer: {
          id: customer.id,
          fullName: customer.fullName,
          sellerCanViewBalance: customer.sellerCanViewBalance === true,
        },
      });
    } catch (e) {
      sendApiJson(res, 404, { error: e.message || "Mijoz sozlamasini saqlab bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/staff" && req.method === "GET") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const state = loadWarehouse();
    sendApiJson(res, 200, {
      ok: true,
      staff: listStaffAccounts(state),
    });
    return true;
  }

  if (apiPath === "/api/warehouse/deleted-customers" && req.method === "GET") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const state = loadWarehouse();
    sendApiJson(res, 200, {
      ok: true,
      customers: listDeletedCustomers(state),
    });
    return true;
  }

  const deletedCustomerMatch = apiPath.match(/^\/api\/warehouse\/deleted-customers\/(\d+)\/restore$/);
  if (deletedCustomerMatch && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    try {
      const state = loadWarehouse();
      const result = restoreDeletedCustomer(state, Number(deletedCustomerMatch[1]));
      saveWarehouse(state);
      sendApiJson(res, 200, {
        ok: true,
        ...result,
        customers: listDeletedCustomers(state),
      });
    } catch (e) {
      sendApiJson(res, 404, { error: e.message || "Mijozni tiklab bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/staff" && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const staff = createStaffAccount(state, body);
      saveWarehouse(state);
      sendApiJson(res, 201, { ok: true, staff, allStaff: listStaffAccounts(state) });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Xodimni saqlab bo'lmadi" });
    }
    return true;
  }

  const staffPermissionsMatch = apiPath.match(/^\/api\/warehouse\/staff\/(\d+)\/permissions$/);
  if (staffPermissionsMatch && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const staff = updateStaffAccountPermissions(state, Number(staffPermissionsMatch[1]), body.permissions);
      saveWarehouse(state);
      sendApiJson(res, 200, { ok: true, staff, allStaff: listStaffAccounts(state) });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Ruxsatlarni saqlab bo'lmadi" });
    }
    return true;
  }

  const staffAccessLinksMatch = apiPath.match(/^\/api\/warehouse\/staff\/(\d+)\/access-links$/);
  if (staffAccessLinksMatch && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const link = createStaffAccessLink(state, Number(staffAccessLinksMatch[1]), body.permission);
      saveWarehouse(state);
      sendApiJson(res, 201, { ok: true, link, allStaff: listStaffAccounts(state) });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Link yaratib bo'lmadi" });
    }
    return true;
  }

  const staffAccessLinkRevokeMatch = apiPath.match(/^\/api\/warehouse\/staff\/(\d+)\/access-links\/([^/]+)$/);
  if (staffAccessLinkRevokeMatch && req.method === "DELETE") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    try {
      const state = loadWarehouse();
      const link = revokeStaffAccessLink(state, Number(staffAccessLinkRevokeMatch[1]), staffAccessLinkRevokeMatch[2]);
      saveWarehouse(state);
      sendApiJson(res, 200, { ok: true, link, allStaff: listStaffAccounts(state) });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Linkni bekor qilib bo'lmadi" });
    }
    return true;
  }

  const staffDeleteMatch = apiPath.match(/^\/api\/warehouse\/staff\/(\d+)$/);
  if (staffDeleteMatch && req.method === "DELETE") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    try {
      const state = loadWarehouse();
      const staff = deleteStaffAccount(state, Number(staffDeleteMatch[1]));
      saveWarehouse(state);
      sendApiJson(res, 200, { ok: true, staff, allStaff: listStaffAccounts(state) });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Xodimni o'chirib bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/approved" && req.method === "GET") {
    const paymentType = u.searchParams.get("paymentType") || "all";
    const requiredPermission = paymentType === "transfer" ? "transfer" : "cash";
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-accountant",
      permission: requiredPermission,
      message: "Hisobot sahifasi uchun ruxsat kerak",
    });
    if (!operator) {
      return true;
    }
    const state = loadWarehouse();
    const pricing = currentWarehousePricing(state);
    const approved = listApprovedTransactions(state, paymentType, pricing);
    const handoffs = paymentType === "cash" ? listSellerCashHandoffs(state) : [];
    const handoffSummary = handoffs.reduce((entries, entry) => {
      const sellerKey = entry.operatorUsername || entry.operatorFullName || `seller-${entry.operatorId || entry.id}`;
      const current = entries.get(sellerKey) || {
        sellerName: entry.operatorFullName || entry.operatorUsername || "Noma'lum sotuvchi",
        operatorUsername: entry.operatorUsername || null,
        totalAmount: 0,
        count: 0,
        lastReceivedAt: null,
      };
      current.totalAmount += Number(entry.amount || 0);
      current.count += 1;
      current.lastReceivedAt = entry.receivedAt || current.lastReceivedAt;
      entries.set(sellerKey, current);
      return entries;
    }, new Map());
    sendApiJson(res, 200, {
      ok: true,
      paymentType,
      approved,
      handoffs,
      handoffSummary: Array.from(handoffSummary.values()).sort((left, right) => right.totalAmount - left.totalAmount),
      summary: summarizeApprovedTransactions(approved),
      pricing,
      operator: serializeOperator(operator),
    });
    return true;
  }

  if (apiPath === "/api/warehouse/seller-sale" && req.method === "POST") {
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    const priceType = String(body?.priceType || "").trim().toLocaleLowerCase("en-US");
    const requiredPermission = priceType === "transfer" ? ["transfer", "seller"] : ["seller"];
    const permissionLabel = priceType === "transfer"
      ? "Savdo yozish uchun бухгалтер ёки сотувчи рухсати керак"
      : "Savdo yozish uchun sotuvchi ruxsati kerak";
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: priceType === "transfer" ? "warehouse-accountant" : "warehouse-seller",
      permission: requiredPermission,
      message: permissionLabel,
    });
    if (!operator) {
      return true;
    }
    try {
      const state = loadWarehouse();
      const pricing = currentWarehousePricing(state);
      const result = recordApprovedSale(state, body, {
        pricing,
        actor: operator,
      });
      const savedPhotos = storeWarehouseTransactionPhotos(body?.photos || body?.photo || []);
      if (savedPhotos.length) {
        result.transaction.photos = savedPhotos;
        result.transaction.photo = savedPhotos[0];
      }
      saveWarehouse(state);
      sendApiJson(res, 201, {
        ok: true,
        customer: result.user,
        debt: result.debt,
        totalPaid: result.totalPaid,
        transaction: result.transaction,
        stockKg: state.warehouse.currentStockKg,
        pricing,
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Savdoni yozib bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/customer-payment" && req.method === "POST") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-seller",
      permission: "seller",
      message: "To'lov yozish uchun sotuvchi ruxsati kerak",
    });
    if (!operator) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const pricing = currentWarehousePricing(state);
      const result = recordCustomerPayment(state, body, {
        pricing,
        actor: operator,
      });
      const savedPhotos = storeWarehouseTransactionPhotos(body?.photos || body?.photo || []);
      if (savedPhotos.length) {
        result.transaction.photos = savedPhotos;
        result.transaction.photo = savedPhotos[0];
      }
      saveWarehouse(state);
      sendApiJson(res, 201, {
        ok: true,
        customer: result.user,
        debt: result.debt,
        totalPaid: result.totalPaid,
        transaction: result.transaction,
        pricing,
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "To'lovni yozib bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/seller-cash-handoffs" && req.method === "POST") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-seller",
      permission: "seller",
      message: "Pul topshirish uchun sotuvchi ruxsati kerak",
    });
    if (!operator) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const pricing = currentWarehousePricing(state);
      const handoff = recordSellerCashHandoff(state, body, {
        actor: operator,
      });
      saveWarehouse(state);
      sendApiJson(res, 201, {
        ok: true,
        handoff,
        dailySummary: summarizeOperatorDailyActivity(state, operator, { pricing }),
        operator: serializeOperator(operator),
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Topshirilgan pulni saqlab bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/pricing" && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const pricing = updateWarehousePricing(state, body);
      saveWarehouse(state);
      sendApiJson(res, 200, { ok: true, pricing });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Narxlarni saqlab bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/stock" && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const stockKg = seedWarehouseStock(state, body.stockKg);
      saveWarehouse(state);
      sendApiJson(res, 200, { ok: true, stockKg, pricing: currentWarehousePricing(state) });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Ombor miqdori noto'g'ri" });
    }
    return true;
  }

  const approveMatch = apiPath.match(/^\/api\/warehouse\/approve\/(\d+)$/);
  if (approveMatch && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    try {
      const state = loadWarehouse();
      const pricing = currentWarehousePricing(state);
      const result = approveTransaction(
        state,
        Number(approveMatch[1]),
        normalizeApprovalPayment(body),
        { pricing }
      );
      saveWarehouse(state);
      await sendTelegramMessage(
        result.user?.telegramId,
        buildDebtReply(result.user?.fullName || "mijoz", result.debt)
      );
      sendApiJson(res, 200, {
        ok: true,
        debt: result.debt,
        totalPaid: result.totalPaid,
        cashPaidAmount: result.transaction.cashPaidAmount,
        transferPaidAmount: result.transaction.transferPaidAmount,
        stockKg: state.warehouse.currentStockKg,
        pricing,
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Tranzaksiyani tasdiqlab bo'lmadi" });
    }
    return true;
  }

  return false;
}