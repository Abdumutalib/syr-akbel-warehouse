import fs from 'fs';
import path from 'path';

const publicDir = path.join(process.cwd(), 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

const SCRIPT_TAG = '<script src="/warehouse/assets/warehouse-api.js"></script>';
const REPLACEMENT = `const apiFetch = (url, options = {}) => window.warehouseApi.fetch(url, options, typeof authHeader === 'function' ? authHeader() : '', typeof accessToken !== 'undefined' ? accessToken : '');`;

for (const file of files) {
  const filePath = path.join(publicDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace apiFetch safely
  const regex = /async function apiFetch[^{]+\{[\s\S]+?return data;\s*\}/;
  if (regex.test(content)) {
    content = content.replace(regex, REPLACEMENT);
  }

  // Inject script tag
  if (!content.includes('warehouse-api.js')) {
    if (content.includes('<script src="/warehouse/assets/warehouse-auth-pin.js"></script>')) {
      content = content.replace('<script src="/warehouse/assets/warehouse-auth-pin.js"></script>', `<script src="/warehouse/assets/warehouse-api.js"></script>\n  <script src="/warehouse/assets/warehouse-auth-pin.js"></script>`);
    } else if (content.includes('</body>')) {
      content = content.replace('</body>', `  ${SCRIPT_TAG}\n</body>`);
    } else {
      content += `\n${SCRIPT_TAG}\n`;
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Refactored', file);
}
