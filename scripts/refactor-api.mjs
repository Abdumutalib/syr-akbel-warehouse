import fs from 'fs';
import path from 'path';

const publicDir = path.join(process.cwd(), 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));

function replaceBlock(content, signature) {
  let startIndex = content.indexOf(signature);
  if (startIndex === -1) return content;
  
  // Find the opening brace
  let openBraceIndex = content.indexOf('{', startIndex);
  if (openBraceIndex === -1) return content;
  
  let braceCount = 1;
  let currentIndex = openBraceIndex + 1;
  
  while (braceCount > 0 && currentIndex < content.length) {
    if (content[currentIndex] === '{') braceCount++;
    if (content[currentIndex] === '}') braceCount--;
    currentIndex++;
  }
  
  const block = content.substring(startIndex, currentIndex);
  
  let replacement = '';
  if (signature.includes('apiFetch')) {
    replacement = `const apiFetch = (url, options = {}) => window.warehouseApi.fetch(url, options, typeof authHeader === 'function' ? authHeader() : '', typeof accessToken !== 'undefined' ? accessToken : '');`;
  } else if (signature.includes('numberFormat')) {
    replacement = `const numberFormat = (val) => window.warehouseApi.numberFormat(val);`;
  }
  
  return content.replace(block, replacement);
}

for (const file of files) {
  const filePath = path.join(publicDir, file);
  let content = fs.readFileSync(filePath, 'utf8');

  // Replace apiFetch
  content = replaceBlock(content, 'async function apiFetch(url');
  
  // Replace numberFormat
  content = replaceBlock(content, 'function numberFormat(value)');

  // Inject script
  const SCRIPT_TAG = '<script src="/warehouse/assets/warehouse-api.js"></script>';
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
