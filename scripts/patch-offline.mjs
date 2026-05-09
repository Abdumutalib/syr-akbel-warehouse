import fs from 'fs';
import path from 'path';

const publicDir = path.join(process.cwd(), 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

const SCRIPT_TAG = '<script src="/warehouse/assets/warehouse-offline.js"></script>';

for (const file of files) {
  const filePath = path.join(publicDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Inject script tag
  if (!content.includes('warehouse-offline.js')) {
    if (content.includes('</body>')) {
      content = content.replace('</body>', `  ${SCRIPT_TAG}\n</body>`);
    } else {
      content += `\n${SCRIPT_TAG}\n`;
    }
  }

  // Regex to match "const response = await fetch(...);" even across multiple lines
  const fetchRegex = /const\s+response\s*=\s*await\s+fetch\s*\([^;]+;/;
  
  if (fetchRegex.test(content) && !content.includes('warehouseOfflineQueue.addRequest')) {
    content = content.replace(fetchRegex, (match) => {
      const fetchCall = match.replace(/^const\s+response\s*=\s*/, 'response = ');
      return `let response;
      try {
        ${fetchCall}
      } catch (err) {
        if (options && options.method && options.method !== 'GET') {
          if (window.warehouseOfflineQueue) {
            await window.warehouseOfflineQueue.addRequest(normalizedUrl, options, typeof authValue !== 'undefined' ? authValue : '', typeof accessToken !== 'undefined' ? accessToken : '');
            return { success: true, offline: true, message: 'Oflayn saqlandi' };
          }
        }
        throw err;
      }`;
    });
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Patched', file);
}
