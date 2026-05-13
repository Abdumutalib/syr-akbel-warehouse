// parseKgExpression funksiyasi (HTML va test uchun universal)
function parseKgExpression(expression) {
  const source = String(expression || '').replace(/\s+/g, '');
  if (!source) {
    return { ok: false, message: 'Kg miqdorini kiriting.' };
  }
  if (!/^[\d+\-*/()%.,]+$/.test(source)) {
    return { ok: false, message: 'Faqat raqam, vergul, nuqta, +, -, *, /, % va () ishlating.' };
  }
  const normalized = source.replace(/,/g, '.');
  const tokens = [];
  let index = 0;
  let expectNumber = true;

  while (index < normalized.length) {
    if (expectNumber) {
      if (normalized[index] === '(') {
        tokens.push({ type: 'leftParen', value: '(' });
        index += 1;
        continue;
      }
      let sign = 1;
      while (normalized[index] === '+' || normalized[index] === '-') {
        if (normalized[index] === '-') {
          sign *= -1;
        }
        index += 1;
      }
      if (normalized[index] === '(') {
        if (sign === -1) {
          tokens.push({ type: 'number', value: -1 });
          tokens.push({ type: 'operator', value: '*' });
        }
        tokens.push({ type: 'leftParen', value: '(' });
        index += 1;
        continue;
      }
      const numberMatch = normalized.slice(index).match(/^\d+(?:\.\d+)?/);
      if (!numberMatch) {
        return { ok: false, message: 'Ifoda noto\'g\'ri. Masalan: (10,285+10,895)-2,000 yoki 10*(4+1)' };
      }
      tokens.push({ type: 'number', value: sign * Number(numberMatch[0]) });
      index += numberMatch[0].length;
      expectNumber = false;
      continue;
    }

    const operator = normalized[index];
    if (operator === '%') {
      tokens.push({ type: 'percent', value: '%' });
      index += 1;
      expectNumber = false;
      continue;
    }
    if (operator === ')') {
      tokens.push({ type: 'rightParen', value: ')' });
      index += 1;
      expectNumber = false;
      continue;
    }
    if (!'+-*/'.includes(operator)) {
      return { ok: false, message: 'Ifoda noto\'g\'ri. Operator xato yozilgan.' };
    }
    tokens.push({ type: 'operator', value: operator });
    index += 1;
    expectNumber = true;
  }

  if (expectNumber) {
    return { ok: false, message: 'Ifoda noto\'g\'ri tugagan.' };
  }

  const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const values = [];
  const operators = [];

  function applyOperator() {
    const operator = operators.pop();
    const right = values.pop();
    const left = values.pop();
    if (!Number.isFinite(left) || !Number.isFinite(right)) {
      throw new Error('Ifoda noto\'g\'ri.');
    }
    if (operator === '+') values.push(left + right);
    if (operator === '-') values.push(left - right);
    if (operator === '*') values.push(left * right);
    if (operator === '/') {
      if (right === 0) {
        throw new Error('0 ga bo\'lish mumkin emas.');
      }
      values.push(left / right);
    }
  }

  try {
    for (const token of tokens) {
      if (token.type === 'number') {
        values.push(token.value);
        continue;
      }
      if (token.type === 'percent') {
        if (!values.length) {
          throw new Error('Foizdan oldin son bo\'lishi kerak.');
        }
        values.push(values.pop() / 100);
        continue;
      }
      if (token.type === 'leftParen') {
        operators.push(token.value);
        continue;
      }
      if (token.type === 'rightParen') {
        while (operators.length && operators[operators.length - 1] !== '(') {
          applyOperator();
        }
        if (!operators.length || operators[operators.length - 1] !== '(') {
          throw new Error('Qavslar noto\'g\'ri yopilgan.');
        }
        operators.pop();
        continue;
      }
      while (operators.length && precedence[operators[operators.length - 1]] >= precedence[token.value]) {
        if (operators[operators.length - 1] === '(') {
          break;
        }
        applyOperator();
      }
      operators.push(token.value);
    }
    while (operators.length) {
      if (operators[operators.length - 1] === '(') {
        throw new Error('Qavslar yopilmagan.');
      }
      applyOperator();
    }
  } catch (error) {
    return { ok: false, message: error.message || 'Ifodani hisoblab bo\'lmadi.' };
  }

  const total = values[0];
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, message: 'Natija 0 dan katta bo\'lishi kerak.' };
  }

  const blockCount = tokens.some((token) => token.type === 'number')
    ? tokens.filter((token) => token.type === 'operator' && (token.value === '+' || token.value === '-')).length + 1
    : 0;

  return {
    ok: true,
    value: Math.round(total * 1000) / 1000,
    blockCount,
  };
}

// Universal eksport (Node.js va browser uchun)
try {
  if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports.parseKgExpression = parseKgExpression;
  }
} catch (e) {}