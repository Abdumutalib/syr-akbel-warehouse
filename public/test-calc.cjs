// Калькулятор логикасини тест қилиш учун
const { parseKgExpression } = require('./calc-logic.cjs');
// parseKgExpression функциясини тест қилиш учун мисоллар:
const testCases = [
  { expr: '10+5', expected: 15 },
  { expr: '10,5+2,5', expected: 13 },
  { expr: '10*2', expected: 20 },
  { expr: '100-25', expected: 75 },
  { expr: '10/2', expected: 5 },
  { expr: '10+5*2', expected: 20 },
  { expr: '(10+5)*2', expected: 30 },
  { expr: '100%', expected: 1 },
  { expr: '200+10%', expected: 200.1 }, // 200 + 0.1
  { expr: '10*(2+3)', expected: 50 },
  { expr: '10,5*2', expected: 21 },
  { expr: '10-2*3', expected: 4 },
  { expr: '10/(2+3)', expected: 2 },
  { expr: '10+5%', expected: 10.05 },
  { expr: '10+5%*2', expected: 10.1 },
  { expr: '10+5%+2', expected: 12.05 },
  { expr: '10+5%+2%', expected: 10.1205 },
  { expr: '10+5%+2%+1', expected: 11.1205 },
  { expr: '10+5%+2%+1%', expected: 10.131205 },
];

console.log('parseKgExpression тестлари:');
testCases.forEach(({ expr, expected }) => {
  const result = parseKgExpression(expr);
  if (result.ok && Math.abs(result.value - expected) < 0.001) {
    console.log(`✅ ${expr} = ${result.value}`);
  } else {
    console.error(`❌ ${expr} => ${result.ok ? result.value : result.message}, кутилган: ${expected}`);
  }
});
