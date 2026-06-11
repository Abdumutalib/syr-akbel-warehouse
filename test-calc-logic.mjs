// Kalkulyator mantiqiy test
function parseKgExpression(expression) {
  const source = String(expression || '').replace(/\s+/g, '');
  if (!source) return { ok: false, message: "Bo'sh" };
  if (!/^[\d+\-*/()%.,]+$/.test(source)) return { ok: false, message: "Noto'g'ri belgilar" };
  const normalized = source.replace(/,/g, '.');
  const tokens = [];
  let index = 0;
  let expectNumber = true;
  while (index < normalized.length) {
    if (expectNumber) {
      if (normalized[index] === '(') { tokens.push({ type: 'leftParen', value: '(' }); index++; continue; }
      let sign = 1;
      while (normalized[index] === '+' || normalized[index] === '-') {
        if (normalized[index] === '-') sign *= -1;
        index++;
      }
      const numberMatch = normalized.slice(index).match(/^\d+(?:\.\d+)?/);
      if (!numberMatch) return { ok: false, message: "Ifoda noto'g'ri" };
      tokens.push({ type: 'number', value: sign * Number(numberMatch[0]) });
      index += numberMatch[0].length;
      expectNumber = false;
      continue;
    }
    const operator = normalized[index];
    if (operator === '%') { tokens.push({ type: 'percent', value: '%' }); index++; expectNumber = false; continue; }
    if (operator === ')') { tokens.push({ type: 'rightParen', value: ')' }); index++; expectNumber = false; continue; }
    if (!'+-*/'.includes(operator)) return { ok: false, message: "Operator xato" };
    tokens.push({ type: 'operator', value: operator });
    index++;
    expectNumber = true;
  }
  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const values = [];
  const operators = [];
  function applyOperator() {
    const op = operators.pop(), rightObj = values.pop(), leftObj = values.pop();
    if (!leftObj || !rightObj) throw new Error("Ifoda noto'g'ri");
    const left = leftObj.val;
    let right = rightObj.val;
    if (rightObj.isPct) {
      if (op === '+' || op === '-') right = left * (right / 100);
      else right = right / 100;
    }
    if (op === '+') values.push({ val: left + right, isPct: false });
    if (op === '-') values.push({ val: left - right, isPct: false });
    if (op === '*') values.push({ val: left * right, isPct: false });
    if (op === '/') { if (right === 0) throw new Error("0 ga bo'lib bo'lmaydi"); values.push({ val: left / right, isPct: false }); }
  }
  try {
    for (const token of tokens) {
      if (token.type === 'number') { values.push({ val: token.value, isPct: false }); continue; }
      if (token.type === 'percent') { const v = values.pop(); values.push({ val: v.val, isPct: true }); continue; }
      if (token.type === 'leftParen') { operators.push('('); continue; }
      if (token.type === 'rightParen') {
        while (operators.length && operators[operators.length-1] !== '(') applyOperator();
        operators.pop(); continue;
      }
      while (operators.length && precedence[operators[operators.length-1]] >= precedence[token.value]) {
        if (operators[operators.length-1] === '(') break;
        applyOperator();
      }
      operators.push(token.value);
    }
    while (operators.length) applyOperator();
  } catch(e) { return { ok: false, message: e.message }; }
  if (values.length !== 1) return { ok: false, message: "Ifoda noto'g'ri" };
  let total = values[0].val;
  if (values[0].isPct) total = total / 100;
  if (!Number.isFinite(total) || total <= 0) return { ok: false, message: "Natija 0 dan katta bo'lishi kerak" };
  return { ok: true, value: Math.round(total * 1000) / 1000 };
}

const tests = [
  { input: '10,285', expected: 10.285 },
  { input: '10,285+10,895', expected: 21.18 },
  { input: '10,285+10,895+12,450', expected: 33.63 },
  { input: '(10,285+10,895)-2,000', expected: 19.18 },
  { input: '100*3', expected: 300 },
  { input: '15,5', expected: 15.5 },
  { input: '7+8+9', expected: 24 },
  { input: '200+15%', expected: 230 },
  { input: '200-15%', expected: 170 },
  { input: '200*15%', expected: 30 },
  { input: '200+10+5%', expected: 220.5 }
];

console.log('=== Kalkulyator logika testi ===\n');
let pass = 0, fail = 0;
for (const t of tests) {
  const r = parseKgExpression(t.input);
  const ok = r.ok && Math.abs(r.value - t.expected) < 0.001;
  const icon = ok ? 'OK' : 'FAIL';
  const val = r.ok ? r.value + ' kg' : r.message;
  console.log(`[${icon}] "${t.input}" => ${val} (kutilgan: ${t.expected})`);
  ok ? pass++ : fail++;
}
console.log(`\nNatija: ${pass} OK, ${fail} FAIL`);

// --- preventScroll tekshirish ---
console.log('\n=== preventScroll production tekshiruvi ===');
import('https://akbelim.com/warehouse/seller/sale/cash').catch(() => {
  // fetch ga o'tamiz
});

const resp = await fetch('https://akbelim.com/warehouse/seller/sale/cash');
const html = await resp.text();
const count = (html.match(/preventScroll/g) || []).length;
if (count >= 2) {
  console.log(`OK preventScroll production da mavjud (${count} ta) - sakrash oldini olindi`);
} else {
  console.log(`WARN preventScroll topilmadi (${count} ta) - eski versiya`);
}

console.log('\n=== Umumiy baho ===');
if (fail === 0 && count >= 2) {
  console.log('100/100 - Kalkulyator to\'g\'ri ishlaydi, sakrash tuzatildi');
} else if (fail === 0) {
  console.log('80/100 - Kalkulyator to\'g\'ri, lekin preventScroll tekshirib ko\'ring');
} else {
  console.log('50/100 - Mantiq xatolari bor');
}
