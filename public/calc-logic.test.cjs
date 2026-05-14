const { parseKgExpression } = require('./calc-logic.cjs');

describe('parseKgExpression', () => {
  test.each([
    ['10+5', 15],
    ['10,5+2,5', 13],
    ['10*2', 20],
    ['100-25', 75],
    ['10/2', 5],
    ['10+5*2', 20],
    ['(10+5)*2', 30],
    ['100%', 1],
    ['200+10%', 200.1],
    ['10*(2+3)', 50],
    ['10,5*2', 21],
    ['10-2*3', 4],
    ['10/(2+3)', 2],
    ['10+5%', 10.05],
    ['10+5%*2', 10.1],
    ['10+5%+2', 12.05],
    ['10+5%+2%+1', 11.1205],
    ['10+5%+2%+1%', 10.131205],
  ])('should parse "%s" as %f', (expr, expected) => {
    const result = parseKgExpression(expr);
    expect(result.ok).toBe(true);
    expect(Math.abs(result.value - expected)).toBeLessThan(0.01);
  });

  test('should fail on invalid input', () => {
    expect(parseKgExpression('abc').ok).toBe(false);
    expect(parseKgExpression('').ok).toBe(false);
    expect(parseKgExpression('10/0').ok).toBe(false);
  });
});
