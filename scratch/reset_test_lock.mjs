import fs from 'node:fs';
import path from 'node:path';

const dataPath = 'C:/Users/Windows 11/.gemini/antigravity/scratch/syr-akbel-warehouse/data/warehouse.json';
const raw = fs.readFileSync(dataPath, 'utf8');
const data = JSON.parse(raw);

for (const account of data.staffAccounts) {
  for (const link of account.accessLinks) {
    delete link.unlockedAt;
  }
}

fs.writeFileSync(dataPath, JSON.stringify(data));
