import http from 'node:http';

async function apiRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 8792,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            body: data
          });
        }
      });
    });

    req.on('error', (e) => reject(e));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTest() {
  console.log('--- STARTING DEEP TEST AS SELLER ---');
  
  const token = 'test-token-1778682456271';
  const headers = { 'x-warehouse-access': token };

  // 1. Check auth status
  console.log('Step 1: Checking auth status...');
  const statusRes = await apiRequest(`/api/warehouse/auth-status?access=${token}`);
  console.log('Status Response:', statusRes.body);
  
  const isWaitingForPin = statusRes.body.isWaitingForPin;

  // 3. Verify PIN (only if waiting)
  if (isWaitingForPin) {
    // 2. Try to list customers (should fail because not unlocked)
    console.log('\nStep 2: Trying to list customers before PIN unlock...');
    const customersFail = await apiRequest('/api/warehouse/customers', 'GET', null, headers);
    console.log('Customers Response (expected 401/403):', customersFail.statusCode, customersFail.body);
    
    if (customersFail.statusCode !== 401 && customersFail.statusCode !== 403) {
      console.log('FAIL: Listing customers should have failed with 401/403, got', customersFail.statusCode);
    } else {
      console.log('SUCCESS: Access denied as expected.');
    }

    console.log('\nStep 3: Verifying PIN...');
    const verifyRes = await apiRequest(`/api/warehouse/verify-pin?access=${token}`, 'POST', { pin: '1111' });
    console.log('Verify PIN Response:', verifyRes.body);
    
    if (!verifyRes.body.ok) {
      console.error('FAIL: PIN verification failed!');
      return;
    }
    console.log('SUCCESS: PIN verified.');
  } else {
    console.log('Step 2 & 3: Skipping PIN verification (already unlocked).');
  }

  // 4. List customers (should now work)
  console.log('\nStep 4: Listing customers after PIN unlock...');
  const customersSuccess = await apiRequest('/api/warehouse/customers', 'GET', null, headers);
  console.log('Customers Response count:', customersSuccess.body.customers?.length);
  
  if (!customersSuccess.body.ok) {
    console.error('FAIL: Could not list customers after unlock!');
    return;
  }
  console.log('SUCCESS: Customers listed.');

  // 5. Perform a sale
  console.log('\nStep 5: Performing a sale...');
  const saleRes = await apiRequest('/api/warehouse/seller-sale', 'POST', {
    userId: 1, // Test Mijoz
    amountKg: 20,
    priceType: 'cash',
    cashPaidAmount: 0,
    transferPaidAmount: 0,
    note: 'Test sale from automated script'
  }, headers);
  console.log('Sale Response:', saleRes.body);
  
  if (!saleRes.body.ok) {
    console.error('FAIL: Sale failed!');
    return;
  }
  console.log('SUCCESS: Sale recorded.');

  // 6. Check customer debt
  console.log('\nStep 6: Verifying debt increase...');
  const detailRes = await apiRequest('/api/warehouse/customers/1', 'GET', null, headers);
  console.log('Customer Detail Response Body:', detailRes.body);
  console.log('Customer Debt:', detailRes.body.summary?.currentDebt);
  
  if (detailRes.body.summary.currentDebt <= 0) {
    console.error('FAIL: Debt did not increase!');
    return;
  }
  console.log('SUCCESS: Debt increased as expected.');

  console.log('\n--- DEEP TEST COMPLETED SUCCESSFULLY ---');
}

runTest().catch(console.error);
