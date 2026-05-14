(function (global) {
  function evaluateKgExpression(expression) {
    const source = String(expression || '').replace(/,/g, '.').replace(/\s+/g, '');
    if (!source) throw new Error('Kg miqdorini kiriting.');

    const tokens = [];
    let index = 0;

    while (index < source.length) {
      const char = source[index];
      if (/\d|\./.test(char)) {
        let next = index + 1;
        while (next < source.length && /\d|\./.test(source[next])) next += 1;
        const raw = source.slice(index, next);
        if ((raw.match(/\./g) || []).length > 1) throw new Error("Noto'g'ri son");
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error("Noto'g'ri son");
        tokens.push({ type: 'number', value });
        index = next;
        continue;
      }
      if ('+-*/()%'.includes(char)) {
        tokens.push({ type: 'op', value: char });
        index += 1;
        continue;
      }
      throw new Error("Noto'g'ri belgi");
    }

    const precedence = { '+': 1, '-': 1, '*': 2, '/': 2 };
    const output = [];
    const ops = [];
    let previous = null;

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (token.type === 'number') {
        output.push(token);
        previous = token;
        continue;
      }

      const op = token.value;
      if (op === '%') {
        output.push({ type: 'op', value: '%' });
        previous = token;
        continue;
      }

      if (op === '(') {
        ops.push(op);
        previous = token;
        continue;
      }

      if (op === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') {
          output.push({ type: 'op', value: ops.pop() });
        }
        if (!ops.length) throw new Error('Qavslar mos emas');
        ops.pop();
        previous = token;
        continue;
      }

      const unaryMinus = op === '-' && (!previous || (previous.type === 'op' && previous.value !== '%' && previous.value !== ')'));
      if (unaryMinus) output.push({ type: 'number', value: 0 });

      if (!precedence[op]) throw new Error('Operator xatosi');
      while (ops.length && precedence[ops[ops.length - 1]] >= precedence[op]) {
        output.push({ type: 'op', value: ops.pop() });
      }
      ops.push(op);
      previous = token;
    }

    while (ops.length) {
      const op = ops.pop();
      if (op === '(' || op === ')') throw new Error('Qavslar mos emas');
      output.push({ type: 'op', value: op });
    }

    const stack = [];
    for (const token of output) {
      if (token.type === 'number') {
        stack.push(token.value);
        continue;
      }

      if (token.value === '%') {
        if (!stack.length) throw new Error('Foiz xatosi');
        stack.push(stack.pop() / 100);
        continue;
      }

      const right = stack.pop();
      const left = stack.pop();
      if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error('Ifoda xatosi');
      if (token.value === '+') stack.push(left + right);
      if (token.value === '-') stack.push(left - right);
      if (token.value === '*') stack.push(left * right);
      if (token.value === '/') {
        if (right === 0) throw new Error("Nolga bo'lib bo'lmaydi");
        stack.push(left / right);
      }
    }

    if (stack.length !== 1 || !Number.isFinite(stack[0])) throw new Error('Ifoda xatosi');
    const value = Math.round(stack[0] * 1000) / 1000;
    if (value <= 0) throw new Error("Natija 0 dan katta bo'lishi kerak.");
    return { ok: true, value, blockCount: Math.max(1, Math.ceil(value / 11)) };
  }

  function parseKgExpression(expression) {
    try {
      return evaluateKgExpression(expression);
    } catch (error) {
      return {
        ok: false,
        value: null,
        blockCount: 0,
        message: error?.message || "Ifodani hisoblab bo'lmadi.",
      };
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseKgExpression };
  } else {
    global.parseKgExpression = parseKgExpression;
  }
})(typeof window !== 'undefined' ? window : globalThis);
