import fs from 'node:fs';
import path from 'node:path';

const dataPath = 'C:/Users/Windows 11/.gemini/antigravity/scratch/syr-akbel-warehouse/data/warehouse.json';
const raw = fs.readFileSync(dataPath, 'utf8');
const data = JSON.parse(raw);

const now = Date.now();
const token = `test-token-${now}`;

// Find or create seller1
let seller = data.staffAccounts.find(a => a.username === 'seller1');
if (!seller) {
  seller = {
    id: data.lastIds.staff + 1,
    username: 'seller1',
    password: 'pass123',
    pin: 'pbkdf2:908d8bdbbaa0e24bb22a8e0f6ea2d7af:976c388be5a7746fb31fe4b218aed0c3a0fdd2e6102162e60b7d7e750dc3416a',
    role: 'seller',
    permissions: ['seller', 'customers'],
    accessLinks: [],
    createdAt: new Date().toISOString()
  };
  data.staffAccounts.push(seller);
  data.lastIds.staff++;
}

seller.accessLinks.push({
  id: `link-${now}`,
  permission: 'seller',
  token: token,
  createdAt: new Date().toISOString()
});

fs.writeFileSync(dataPath, JSON.stringify(data));
console.log(token);
