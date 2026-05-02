export async function handleWarehouseApiRoute(req, res, u, apiPath, deps) {
  const {
    assertWarehouseAdmin,
    assertWarehouseOperator,
    buildDebtReply,
    buildPendingReply,
    createStaffAccessLink,
    createStaffAccount,
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
      const customer = await writeWarehouse((state) => upsertCustomer(state, body, { actor: operator }));
      sendApiJson(res, 201, { ok: true, customer });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Mijozni saqlab bo'lmadi" });
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
    try {
      const { result, stockKg, pricing } = await writeWarehouse((state) => {
        const pricing = currentWarehousePricing(state);
        const result = recordApprovedSale(state, body, {
          pricing,
          actor: operator,
        });
        return {
          result,
          stockKg: state.warehouse.currentStockKg,
          pricing,
        };
      });
      const saleCashPaid = Number(result.transaction?.cashPaidAmount || 0);
      const saleTransferPaid = Number(result.transaction?.transferPaidAmount || 0);
      await sendTelegramChannelMessage(
        buildChannelSaleMsg(
          result.user?.fullName || "Noma'lum",
          result.transaction.amountKg,
          result.transaction.totalPrice,
          saleCashPaid,
          saleTransferPaid,
          result.debt
        )
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
      sendApiJson(res, 201, {
        ok: true,
        customer: result.user,
        debt: result.debt,
        totalPaid: result.totalPaid,
        transaction: result.transaction,
        stockKg,
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
      const { result, pricing } = await writeWarehouse((state) => {
        const pricing = currentWarehousePricing(state);
        const result = recordCustomerPayment(state, body, {
          pricing,
          actor: operator,
        });
        return { result, pricing };
      });
      const payCashPaid = Number(result.transaction?.cashPaidAmount || 0);
      const payTransferPaid = Number(result.transaction?.transferPaidAmount || 0);
      await sendTelegramChannelMessage(
        buildChannelPaymentMsg(
          result.user?.fullName || "Noma'lum",
          payCashPaid,
          payTransferPaid,
          result.debt
        )
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
    try {
      const { result, stockKg, pricing } = await writeWarehouse((state) => {
        const pricing = currentWarehousePricing(state);
        const result = approveTransaction(
          state,
          Number(approveMatch[1]),
          normalizeApprovalPayment(body),
          { pricing }
        );
        return {
          result,
          stockKg: state.warehouse.currentStockKg,
          pricing,
        };
      });
      const approveCashPaid = Number(result.transaction?.cashPaidAmount || 0);
      const approveTransferPaid = Number(result.transaction?.transferPaidAmount || 0);
      await sendTelegramChannelMessage(
        buildChannelApprovalMsg(
          result.user?.fullName || "Noma'lum",
          result.transaction.amountKg,
          result.transaction.totalPrice,
          approveCashPaid,
          approveTransferPaid,
          result.debt
        )
      );
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
        stockKg,
        pricing,
      });
    } catch (e) {
      sendApiJson(res, 400, { error: e.message || "Tranzaksiyani tasdiqlab bo'lmadi" });
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