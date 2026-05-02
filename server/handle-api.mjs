import crypto from "node:crypto";

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
    listWarehouseOrders,
    listStaffAccounts,
    loadWarehouse,
    withWarehouseRead,
    withWarehouseWrite,
    normalizeApprovalPayment,
    readPostJson,
    recordApprovedSale,
    recordCustomerPayment,
    restoreDeletedCustomer,
    revokeStaffAccessLink,
    saveWarehouse,
    seedWarehouseStock,
    sendApiJson,
    sendTelegramMessage,
    sendTelegramChannelMessage,
    sendTelegramCashChannelMessage,
    sendTelegramTransferChannelMessage,
    sendTransactionPhotosToChannels,
    sendTelegramAdminDm,
    buildChannelSaleMsg,
    buildChannelPaymentMsg,
    buildChannelApprovalMsg,
    buildChannelNewOrderMsg,
    buildAdminNewOrderMsg,
    buildCustomerSaleMsg,
    buildCustomerPaymentMsg,
    summarizeApprovedTransactions,
    summarizeCustomers,
    approveTransaction,
    updateStaffAccountPermissions,
    updateWarehousePricing,
    upsertCustomer,
  } = deps;

  const readWarehouse =
    typeof withWarehouseRead === "function"
      ? withWarehouseRead
      : (handler) => handler(loadWarehouse());
  const writeWarehouse =
    typeof withWarehouseWrite === "function"
      ? withWarehouseWrite
      : async (handler) => {
          const state = loadWarehouse();
          const result = await handler(state);
          saveWarehouse(state);
          return result;
        };

  const isAdminOperator = (operator) =>
    Boolean(
      operator &&
      (String(operator.kind || "").trim().toLocaleLowerCase("en-US") === "admin" ||
        String(operator.role || "").trim().toLocaleLowerCase("en-US") === "admin")
    );

  const canAccessCustomer = (operator, customer) => {
    if (isAdminOperator(operator)) {
      return true;
    }
    const operatorId = Number(operator?.id);
    if (!Number.isFinite(operatorId) || operatorId <= 0) {
      return false;
    }
    return Number(customer?.ownerOperatorId) === operatorId;
  };

  const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
  const IDEMPOTENCY_MAX_ENTRIES = 2000;
  const extractIdempotencyKey = (request) => {
    const value = request.headers["idempotency-key"] || request.headers["Idempotency-Key"];
    if (typeof value !== "string") {
      return "";
    }
    return value.trim().slice(0, 128);
  };

  const buildIdempotencyFingerprint = (requestPath, body, operator) => {
    const actor = {
      id: operator?.id ?? null,
      username: operator?.username ?? null,
      role: operator?.role ?? null,
      kind: operator?.kind ?? null,
    };
    const serialized = JSON.stringify({
      method: req.method,
      path: requestPath,
      actor,
      body: body ?? null,
    });
    return crypto.createHash("sha256").update(serialized).digest("hex");
  };

  const pruneIdempotencyEntries = (state) => {
    if (!Array.isArray(state.idempotencyRequests)) {
      state.idempotencyRequests = [];
      return;
    }
    const now = Date.now();
    state.idempotencyRequests = state.idempotencyRequests.filter((entry) => {
      const createdAt = new Date(entry?.createdAt || 0).getTime();
      if (!Number.isFinite(createdAt) || createdAt <= 0) {
        return false;
      }
      return now - createdAt <= IDEMPOTENCY_RETENTION_MS;
    });
    if (state.idempotencyRequests.length > IDEMPOTENCY_MAX_ENTRIES) {
      state.idempotencyRequests = state.idempotencyRequests.slice(0, IDEMPOTENCY_MAX_ENTRIES);
    }
  };

  const getIdempotencyHit = (state, key, fingerprint) => {
    if (!key) {
      return { type: "miss" };
    }
    pruneIdempotencyEntries(state);
    const hit = (state.idempotencyRequests || []).find((entry) => entry.key === key);
    if (!hit) {
      return { type: "miss" };
    }
    if (hit.fingerprint !== fingerprint) {
      return { type: "conflict" };
    }
    return {
      type: "replay",
      statusCode: Number(hit.statusCode || 200),
      responseBody: hit.responseBody || { ok: true },
    };
  };

  const saveIdempotencyResult = (state, key, fingerprint, statusCode, responseBody) => {
    if (!key) {
      return;
    }
    pruneIdempotencyEntries(state);
    const nowIso = new Date().toISOString();
    state.idempotencyRequests = (state.idempotencyRequests || []).filter((entry) => entry.key !== key);
    state.idempotencyRequests.unshift({
      key,
      fingerprint,
      statusCode,
      responseBody,
      createdAt: nowIso,
    });
    if (state.idempotencyRequests.length > IDEMPOTENCY_MAX_ENTRIES) {
      state.idempotencyRequests = state.idempotencyRequests.slice(0, IDEMPOTENCY_MAX_ENTRIES);
    }
  };

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
      const result = await createWarehouseTransaction(payload);
      await sendTelegramMessage(payload.telegramId, buildPendingReply(result));
      await sendTelegramAdminDm(
        buildAdminNewOrderMsg(
          result.user?.fullName || "Noma'lum",
          result.transaction.amountKg,
          result.transaction.totalPrice
        )
      );
      await sendTelegramChannelMessage(
        buildChannelNewOrderMsg(
          result.user?.fullName || "Noma'lum",
          result.transaction.amountKg,
          result.transaction.totalPrice
        )
      );
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
      const result = await createWarehouseTransaction(body);
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
    const { pending, stockKg, pricing } = readWarehouse((state) => {
      const pricing = currentWarehousePricing(state);
      return {
        pending: listPendingTransactions(state, pricing),
        stockKg: state.warehouse.currentStockKg,
        pricing,
      };
    });
    sendApiJson(res, 200, {
      ok: true,
      pending,
      stockKg,
      pricing,
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
    const { customers, stockKg, pricing } = readWarehouse((state) => {
      const pricing = currentWarehousePricing(state);
      const allCustomers = listCustomerSummaries(state, pricing);
      return {
        customers: allCustomers.filter((customer) => canAccessCustomer(operator, customer)),
        stockKg: state.warehouse.currentStockKg,
        pricing,
      };
    });
    sendApiJson(res, 200, {
      ok: true,
      customers,
      summary: summarizeCustomers(customers),
      stockKg,
      pricing,
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
    const catalog = readWarehouse((state) => {
      const grouped = groupCustomersByPaymentType(state, currentWarehousePricing(state));
      const filterCustomers = (list) => list.filter((customer) => canAccessCustomer(operator, customer));
      return {
        cashCustomers: filterCustomers(grouped.cashCustomers || []),
        transferCustomers: filterCustomers(grouped.transferCustomers || []),
        otherCustomers: filterCustomers(grouped.otherCustomers || []),
      };
    });
    sendApiJson(res, 200, {
      ok: true,
      ...catalog,
    });
    return true;
  }

  if (apiPath === "/api/warehouse/order-customer-directory" && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      permission: "customers",
      message: "Zakaz sahifasi uchun ruxsat kerak",
    });
    if (!operator) {
      return true;
    }
    const customers = readWarehouse((state) => {
      const pricing = currentWarehousePricing(state);
      const allCustomers = listCustomerSummaries(state, pricing);
      return allCustomers.filter((customer) => canAccessCustomer(operator, customer));
    });
    sendApiJson(res, 200, {
      ok: true,
      customers,
    });
    return true;
  }

  if (apiPath === "/api/warehouse/orders" && req.method === "GET") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      permission: "customers",
      message: "Zakazlar sahifasi uchun ruxsat kerak",
    });
    if (!operator) {
      return true;
    }
    const orders = readWarehouse((state) => {
      const allOrders = listWarehouseOrders(state);
      if (isAdminOperator(operator)) {
        return allOrders;
      }
      const operatorId = Number(operator?.id);
      if (!Number.isFinite(operatorId) || operatorId <= 0) {
        return [];
      }
      return allOrders.filter((entry) => Number(entry.operatorId) === operatorId);
    });
    sendApiJson(res, 200, {
      ok: true,
      orders,
      operator,
    });
    return true;
  }

  if (apiPath === "/api/warehouse/orders" && req.method === "POST") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-staff",
      permission: "customers",
      message: "Zakaz yozish uchun ruxsat kerak",
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
      const order = await writeWarehouse((state) => createWarehouseOrder(state, body, operator));
      sendApiJson(res, 201, { ok: true, order });
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
    const idempotencyKey = extractIdempotencyKey(req);
    const idempotencyFingerprint = buildIdempotencyFingerprint(apiPath, body, operator);
    try {
      const outcome = await writeWarehouse((state) => {
        const hit = getIdempotencyHit(state, idempotencyKey, idempotencyFingerprint);
        if (hit.type === "conflict") {
          const err = new Error("Idempotency key boshqa so'rov bilan ishlatilgan");
          err.statusCode = 409;
          throw err;
        }
        if (hit.type === "replay") {
          return { replay: true, statusCode: hit.statusCode, responseBody: hit.responseBody };
        }
        const customer = upsertCustomer(state, body, { actor: operator });
        const responseBody = { ok: true, customer };
        saveIdempotencyResult(state, idempotencyKey, idempotencyFingerprint, 201, responseBody);
        return { replay: false, statusCode: 201, responseBody };
      });
      sendApiJson(res, outcome.statusCode, outcome.responseBody);
    } catch (e) {
      sendApiJson(res, e.statusCode || 400, { error: e.message || "Mijozni saqlab bo'lmadi" });
    }
    return true;
  }

  const customerDetailMatch = apiPath.match(/^\/api\/warehouse\/customers\/(\d+)$/);
  if (customerDetailMatch && req.method === "DELETE") {
    const operator = assertWarehouseOperator(req, res, {
      roles: ["seller"],
      allowAdmin: true,
      realm: "warehouse-seller",
      message: "Mijozni o'chirish учун sotuvchi yoki admin ruxsati kerak",
    });
    if (!operator) {
      return true;
    }
    try {
      const result = await writeWarehouse((state) => {
        const detail = getCustomerDetail(state, Number(customerDetailMatch[1]), currentWarehousePricing(state));
        if (!canAccessCustomer(operator, detail?.customer || null)) {
          const err = new Error("Bu mijozga ruxsat yo'q");
          err.statusCode = 403;
          throw err;
        }
        return deleteCustomer(state, Number(customerDetailMatch[1]));
      });
      sendApiJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendApiJson(res, e.statusCode || 404, { error: e.message || "Mijozni o'chirib bo'lmadi" });
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
      const detail = readWarehouse((state) =>
        getCustomerDetail(state, Number(customerDetailMatch[1]), currentWarehousePricing(state))
      );
      if (!canAccessCustomer(operator, detail?.customer || null)) {
        sendApiJson(res, 403, { error: "Bu mijozga ruxsat yo'q" });
        return true;
      }
      sendApiJson(res, 200, {
        ok: true,
        ...detail,
      });
    } catch (e) {
      sendApiJson(res, 404, { error: e.message || "Mijoz topilmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/staff" && req.method === "GET") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const staff = readWarehouse((state) => listStaffAccounts(state));
    sendApiJson(res, 200, {
      ok: true,
      staff,
    });
    return true;
  }

  if (apiPath === "/api/warehouse/deleted-customers" && req.method === "GET") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const customers = readWarehouse((state) => listDeletedCustomers(state));
    sendApiJson(res, 200, {
      ok: true,
      customers,
    });
    return true;
  }

  const deletedCustomerMatch = apiPath.match(/^\/api\/warehouse\/deleted-customers\/(\d+)\/restore$/);
  if (deletedCustomerMatch && req.method === "POST") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    try {
      const result = await writeWarehouse((state) => restoreDeletedCustomer(state, Number(deletedCustomerMatch[1])));
      const customers = readWarehouse((state) => listDeletedCustomers(state));
      sendApiJson(res, 200, {
        ok: true,
        ...result,
        customers,
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
      const result = await writeWarehouse((state) => {
        const staff = createStaffAccount(state, body);
        return { staff, allStaff: listStaffAccounts(state) };
      });
      sendApiJson(res, 201, { ok: true, ...result });
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
      const result = await writeWarehouse((state) => {
        const staff = updateStaffAccountPermissions(state, Number(staffPermissionsMatch[1]), body.permissions);
        return { staff, allStaff: listStaffAccounts(state) };
      });
      sendApiJson(res, 200, { ok: true, ...result });
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
      const result = await writeWarehouse((state) => {
        const link = createStaffAccessLink(state, Number(staffAccessLinksMatch[1]), body.permission);
        return { link, allStaff: listStaffAccounts(state) };
      });
      sendApiJson(res, 201, { ok: true, ...result });
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
      const result = await writeWarehouse((state) => {
        const link = revokeStaffAccessLink(state, Number(staffAccessLinkRevokeMatch[1]), staffAccessLinkRevokeMatch[2]);
        return { link, allStaff: listStaffAccounts(state) };
      });
      sendApiJson(res, 200, { ok: true, ...result });
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
      const result = await writeWarehouse((state) => {
        const staff = deleteStaffAccount(state, Number(staffDeleteMatch[1]));
        return { staff, allStaff: listStaffAccounts(state) };
      });
      sendApiJson(res, 200, { ok: true, ...result });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Xodimni o'chirib bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/approved" && req.method === "GET") {
    const paymentType = u.searchParams.get("paymentType") || "all";
    const requiredPermission = paymentType === "transfer" ? "transfer" : "cash";
    if (!assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-accountant",
      permission: requiredPermission,
      message: "Hisobot sahifasi uchun ruxsat kerak",
    })) {
      return true;
    }
    const { approved, pricing } = readWarehouse((state) => {
      const pricing = currentWarehousePricing(state);
      return {
        approved: listApprovedTransactions(state, paymentType, pricing),
        pricing,
      };
    });
    sendApiJson(res, 200, {
      ok: true,
      paymentType,
      approved,
      summary: summarizeApprovedTransactions(approved),
      pricing,
    });
    return true;
  }

  if (apiPath === "/api/warehouse/seller-sale" && req.method === "POST") {
    const operator = assertWarehouseOperator(req, res, {
      allowAdmin: true,
      realm: "warehouse-seller",
      permission: "seller",
      message: "Savdo yozish uchun sotuvchi ruxsati kerak",
    });
    if (!operator) {
      return true;
    }
    const body = await readPostJson(req);
    if (body === null) {
      sendApiJson(res, 400, { error: "JSON formati noto'g'ri" });
      return true;
    }
    const idempotencyKey = extractIdempotencyKey(req);
    const idempotencyFingerprint = buildIdempotencyFingerprint(apiPath, body, operator);
    try {
      const { replay, statusCode, responseBody, result } = await writeWarehouse((state) => {
        const hit = getIdempotencyHit(state, idempotencyKey, idempotencyFingerprint);
        if (hit.type === "conflict") {
          const err = new Error("Idempotency key boshqa so'rov bilan ishlatilgan");
          err.statusCode = 409;
          throw err;
        }
        if (hit.type === "replay") {
          return {
            replay: true,
            statusCode: hit.statusCode,
            responseBody: hit.responseBody,
            result: null,
          };
        }
        const pricing = currentWarehousePricing(state);
        const result = recordApprovedSale(state, body, {
          pricing,
          actor: operator,
        });
        const responseBody = {
          ok: true,
          customer: result.user,
          debt: result.debt,
          totalPaid: result.totalPaid,
          transaction: result.transaction,
          stockKg: state.warehouse.currentStockKg,
          pricing,
        };
        saveIdempotencyResult(state, idempotencyKey, idempotencyFingerprint, 201, responseBody);
        return { replay: false, statusCode: 201, responseBody, result };
      });
      if (replay) {
        sendApiJson(res, statusCode, responseBody);
        return true;
      }
      const saleCashPaid = Number(result.transaction?.cashPaidAmount || 0);
      const saleTransferPaid = Number(result.transaction?.transferPaidAmount || 0);
      const saleMsgText = buildChannelSaleMsg(
        result.user?.fullName || "Noma'lum",
        result.transaction.amountKg,
        result.transaction.totalPrice,
        saleCashPaid,
        saleTransferPaid,
        result.debt
      );
      await sendTelegramChannelMessage(saleMsgText);
      if (saleCashPaid > 0) await sendTelegramCashChannelMessage(saleMsgText);
      if (saleTransferPaid > 0) await sendTelegramTransferChannelMessage(saleMsgText);
      await sendTransactionPhotosToChannels(
        result.transaction?.photos,
        saleCashPaid,
        saleTransferPaid,
        `👤 ${result.user?.fullName || "Noma'lum"} | ${result.transaction.amountKg} kg`
      );
      await sendTelegramMessage(
        result.user?.telegramId,
        buildCustomerSaleMsg(
          result.user?.fullName || "Hurmatli mijoz",
          result.transaction.amountKg,
          result.transaction.totalPrice,
          result.debt
        )
      );
      sendApiJson(res, statusCode, responseBody);
    } catch (e) {
      sendApiJson(res, e.statusCode || 400, { error: e.message || "Savdoni yozib bo'lmadi" });
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
    const idempotencyKey = extractIdempotencyKey(req);
    const idempotencyFingerprint = buildIdempotencyFingerprint(apiPath, body, operator);
    try {
      const { replay, statusCode, responseBody, result } = await writeWarehouse((state) => {
        const hit = getIdempotencyHit(state, idempotencyKey, idempotencyFingerprint);
        if (hit.type === "conflict") {
          const err = new Error("Idempotency key boshqa so'rov bilan ishlatilgan");
          err.statusCode = 409;
          throw err;
        }
        if (hit.type === "replay") {
          return {
            replay: true,
            statusCode: hit.statusCode,
            responseBody: hit.responseBody,
            result: null,
          };
        }
        const pricing = currentWarehousePricing(state);
        const result = recordCustomerPayment(state, body, {
          pricing,
          actor: operator,
        });
        const responseBody = {
          ok: true,
          customer: result.user,
          debt: result.debt,
          totalPaid: result.totalPaid,
          transaction: result.transaction,
          pricing,
        };
        saveIdempotencyResult(state, idempotencyKey, idempotencyFingerprint, 201, responseBody);
        return { replay: false, statusCode: 201, responseBody, result };
      });
      if (replay) {
        sendApiJson(res, statusCode, responseBody);
        return true;
      }
      const payCashPaid = Number(result.transaction?.cashPaidAmount || 0);
      const payTransferPaid = Number(result.transaction?.transferPaidAmount || 0);
      const payMsgText = buildChannelPaymentMsg(
        result.user?.fullName || "Noma'lum",
        payCashPaid,
        payTransferPaid,
        result.debt
      );
      await sendTelegramChannelMessage(payMsgText);
      if (payCashPaid > 0) await sendTelegramCashChannelMessage(payMsgText);
      if (payTransferPaid > 0) await sendTelegramTransferChannelMessage(payMsgText);
      await sendTransactionPhotosToChannels(
        result.transaction?.photos,
        payCashPaid,
        payTransferPaid,
        `👤 ${result.user?.fullName || "Noma'lum"} | To'lov`
      );
      await sendTelegramMessage(
        result.user?.telegramId,
        buildCustomerPaymentMsg(
          result.user?.fullName || "Hurmatli mijoz",
          payCashPaid,
          payTransferPaid,
          result.debt
        )
      );
      sendApiJson(res, statusCode, responseBody);
    } catch (e) {
      sendApiJson(res, e.statusCode || 400, { error: e.message || "To'lovni yozib bo'lmadi" });
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
      const pricing = await writeWarehouse((state) => updateWarehousePricing(state, body));
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
      const { stockKg, pricing } = await writeWarehouse((state) => {
        const stockKg = seedWarehouseStock(state, body.stockKg);
        return { stockKg, pricing: currentWarehousePricing(state) };
      });
      sendApiJson(res, 200, { ok: true, stockKg, pricing });
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
    const idempotencyKey = extractIdempotencyKey(req);
    const idempotencyFingerprint = buildIdempotencyFingerprint(apiPath, body, {
      kind: "admin",
      role: "admin",
      id: 0,
      username: "admin",
    });
    try {
      const { replay, statusCode, responseBody, result } = await writeWarehouse((state) => {
        const hit = getIdempotencyHit(state, idempotencyKey, idempotencyFingerprint);
        if (hit.type === "conflict") {
          const err = new Error("Idempotency key boshqa so'rov bilan ishlatilgan");
          err.statusCode = 409;
          throw err;
        }
        if (hit.type === "replay") {
          return {
            replay: true,
            statusCode: hit.statusCode,
            responseBody: hit.responseBody,
            result: null,
          };
        }
        const pricing = currentWarehousePricing(state);
        const result = approveTransaction(
          state,
          Number(approveMatch[1]),
          normalizeApprovalPayment(body),
          { pricing }
        );
        const responseBody = {
          ok: true,
          debt: result.debt,
          totalPaid: result.totalPaid,
          cashPaidAmount: result.transaction.cashPaidAmount,
          transferPaidAmount: result.transaction.transferPaidAmount,
          stockKg: state.warehouse.currentStockKg,
          pricing,
        };
        saveIdempotencyResult(state, idempotencyKey, idempotencyFingerprint, 200, responseBody);
        return { replay: false, statusCode: 200, responseBody, result };
      });
      if (replay) {
        sendApiJson(res, statusCode, responseBody);
        return true;
      }
      const approveCashPaid = Number(result.transaction?.cashPaidAmount || 0);
      const approveTransferPaid = Number(result.transaction?.transferPaidAmount || 0);
      const approveMsgText = buildChannelApprovalMsg(
        result.user?.fullName || "Noma'lum",
        result.transaction.amountKg,
        result.transaction.totalPrice,
        approveCashPaid,
        approveTransferPaid,
        result.debt
      );
      await sendTelegramChannelMessage(approveMsgText);
      if (approveCashPaid > 0) await sendTelegramCashChannelMessage(approveMsgText);
      if (approveTransferPaid > 0) await sendTelegramTransferChannelMessage(approveMsgText);
      await sendTransactionPhotosToChannels(
        result.transaction?.photos,
        approveCashPaid,
        approveTransferPaid,
        `👤 ${result.user?.fullName || "Noma'lum"} | Tasdiqlandi`
      );
      await sendTelegramMessage(
        result.user?.telegramId,
        buildDebtReply(result.user?.fullName || "mijoz", result.debt)
      );
      sendApiJson(res, statusCode, responseBody);
    } catch (e) {
      sendApiJson(res, e.statusCode || 400, { error: e.message || "Tranzaksiyani tasdiqlab bo'lmadi" });
    }
    return true;
  }

  if (apiPath === "/api/warehouse/export-csv" && req.method === "GET") {
    if (!assertWarehouseAdmin(req, res)) {
      return true;
    }
    const { csv } = readWarehouse((state) => {
      const pricing = currentWarehousePricing(state);
      const userMap = new Map(state.users.map((u) => [u.id, u.fullName]));
    const KIND_LABELS = { sale: "Savdo", payment: "To'lov", "pending-sale": "Kutilayotgan" };
    const STATUS_LABELS = { approved: "Tasdiqlangan", pending: "Kutilayotgan" };
    const SEP = ";";
    const csvEscape = (v) => {
      const s = String(v == null ? "" : v);
      return s.includes(SEP) || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Mijoz ismi", "Tur", "Holat", "Sana", "kg", "Summa (so'm)", "Naqd to'lov", "O'tkazma to'lov"].join(SEP);
    const rows = state.transactions
      .slice()
      .sort((a, b) => new Date(a.approvedAt || a.createdAt || 0) - new Date(b.approvedAt || b.createdAt || 0))
      .map((tx) => {
        const name = userMap.get(tx.userId) || "Noma'lum";
        const kind = KIND_LABELS[tx.kind || (tx.status === "pending" ? "pending-sale" : "sale")] || tx.kind || "";
        const status = STATUS_LABELS[tx.status] || tx.status || "";
        const date = tx.approvedAt || tx.createdAt || "";
        const dateStr = date ? new Date(date).toLocaleDateString("ru-RU") : "";
        const kg = Number(tx.amountKg || 0);
        const total = Number(tx.totalPrice || 0);
        const cash = Number(tx.cashPaidAmount || 0);
        const transfer = Number(tx.transferPaidAmount || 0);
        return [name, kind, status, dateStr, kg, total, cash, transfer].map(csvEscape).join(SEP);
      });
      return {
        csv: [header, ...rows].join("\r\n"),
      };
    });
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="akbel-export.csv"',
    });
    res.end("\uFEFF" + csv);
    return true;
  }

  return false;
}