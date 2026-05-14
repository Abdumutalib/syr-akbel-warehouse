import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const { parseKgExpression } = require("../public/calc-logic.cjs");

describe("parseKgExpression", () => {
  test("calculates addition and multiplication with precedence", () => {
    const result = parseKgExpression("10+5*2");
    assert.equal(result.ok, true);
    assert.equal(result.value, 20);
  });

  test("calculates parentheses", () => {
    assert.equal(parseKgExpression("(10+5)*2").value, 30);
  });

  test("calculates percent as divided by 100", () => {
    assert.equal(parseKgExpression("100%").value, 1);
    assert.equal(parseKgExpression("200+10%").value, 200.1);
    assert.equal(parseKgExpression("10+5%+2").value, 12.05);
  });

  test("supports decimal comma", () => {
    assert.equal(parseKgExpression("1,5+2,25").value, 3.75);
  });

  test("returns suggested block count by 11 kg sacks", () => {
    assert.equal(parseKgExpression("22").blockCount, 2);
    assert.equal(parseKgExpression("23").blockCount, 3);
  });

  test("returns ok false on invalid expression", () => {
    assert.equal(parseKgExpression("").ok, false);
    assert.equal(parseKgExpression("10/0").ok, false);
    assert.equal(parseKgExpression("10++").ok, false);
  });
});
