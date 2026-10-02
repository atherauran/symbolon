export type Expression =
  | { type: 'number'; value: number }
  | { type: 'variable' }
  | { type: 'unary'; op: '-' | '√'; value: Expression }
  | { type: 'binary'; op: string; left: Expression; right: Expression };

/** A real value. Integer arithmetic stays exact as a fraction [numerator, denominator]. */
export interface Value {
  num: number;
  fraction?: [number, number];
}
export interface EvaluationResult {
  valid: boolean;
  value?: Value;
  display: string;
  error?: string;
}

const EPS = 1e-9;
export const OPERATORS = ['+', '-', '*', '/', '^', '√'];
export const isOperator = (source: string) => OPERATORS.includes(source);
export const near = (a: number, b: number) => Math.abs(a - b) < EPS;

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a);
}
function exact(n: number, d = 1): Value {
  if (!d) throw new Error('Cannot divide by zero');
  const g = gcd(n, d) || 1,
    sign = d < 0 ? -1 : 1;
  return { num: n / d, fraction: [(sign * n) / g, (sign * d) / g] };
}
const real = (num: number): Value => ({ num: Math.abs(num) < EPS ? 0 : num });

export function format(v: Value): string {
  const text = v.fraction && v.fraction[1] !== 1 ? `${v.fraction[0]}/${v.fraction[1]}` : String(+v.num.toFixed(3));
  return text.replace('-', '−');
}

function binary(op: string, a: Value, b: Value): Value {
  if (a.fraction && b.fraction && op !== '^') {
    const [an, ad] = a.fraction,
      [bn, bd] = b.fraction;
    if (op === '+') return exact(an * bd + bn * ad, ad * bd);
    if (op === '-') return exact(an * bd - bn * ad, ad * bd);
    if (op === '*') return exact(an * bn, ad * bd);
    return exact(an * bd, ad * bn);
  }
  if (op === '+') return real(a.num + b.num);
  if (op === '-') return real(a.num - b.num);
  if (op === '*') return real(a.num * b.num);
  if (op === '/') {
    if (Math.abs(b.num) < EPS) throw new Error('Cannot divide by zero');
    return real(a.num / b.num);
  }
  if (!Number.isInteger(b.num) || Math.abs(b.num) > 12) throw new Error('Use a whole-number power from −12 to 12');
  if (Math.abs(a.num) < EPS && b.num <= 0) throw new Error('This power is undefined');
  let result = exact(1);
  for (let i = 0; i < Math.abs(b.num); i++) result = binary('*', result, a);
  return b.num < 0 ? binary('/', exact(1), result) : result;
}
function root(v: Value): Value {
  if (v.num < -EPS) throw new Error('A negative number has no real square root');
  if (v.fraction) {
    const [n, d] = v.fraction,
      rn = Math.round(Math.sqrt(n)),
      rd = Math.round(Math.sqrt(d));
    if (rn * rn === n && rd * rd === d) return exact(rn, rd);
  }
  return real(Math.sqrt(Math.max(0, v.num)));
}

interface Lexeme {
  text: string;
  at: number;
}
class Parser {
  tokens: Lexeme[] = [];
  index = 0;
  constructor(source: string) {
    const normalized = source.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-').replaceAll('𝑥', 'x');
    const regex = /\s+|\d+(?:\.\d+)?|[x+\-*/^√()]/gy;
    let at = 0;
    while (at < normalized.length) {
      regex.lastIndex = at;
      const match = regex.exec(normalized);
      if (!match) throw new Error('This symbol is not supported');
      if (match[0].trim()) this.tokens.push({ text: match[0], at });
      at = regex.lastIndex;
    }
  }
  peek(): string {
    return this.tokens[this.index]?.text ?? '';
  }
  take(): string {
    return this.tokens[this.index++]?.text ?? '';
  }
  parse(min = 0): Expression {
    const token = this.take();
    let left: Expression;
    if (!token) throw new Error('A number is missing');
    if (token === '-' || token === '√') left = { type: 'unary', op: token, value: this.parse(25) };
    else if (token === '(') {
      left = this.parse();
      if (this.take() !== ')') throw new Error('Close the parentheses');
    } else if (/^\d/.test(token)) left = { type: 'number', value: Number(token) };
    else if (token === 'x') left = { type: 'variable' };
    else throw new Error('A number belongs here');
    while (this.peek()) {
      const op = this.peek();
      if (op === ')') break;
      const precedence = ({ '+': 10, '-': 10, '*': 20, '/': 20, '^': 30 } as Record<string, number>)[op];
      if (precedence === undefined) throw new Error('These terms do not connect');
      if (precedence < min) break;
      this.take();
      left = { type: 'binary', op, left, right: this.parse(op === '^' ? precedence : precedence + 1) };
    }
    return left;
  }
}
function run(node: Expression, x?: Value): Value {
  if (node.type === 'number') return Number.isInteger(node.value) ? exact(node.value) : real(node.value);
  if (node.type === 'variable') {
    if (!x) throw new Error('𝑥 has no value yet');
    return x;
  }
  if (node.type === 'unary')
    return node.op === '-' ? binary('*', exact(-1), run(node.value, x)) : root(run(node.value, x));
  return binary(node.op, run(node.left, x), run(node.right, x));
}

/** Evaluates a carried expression. `x` substitutes the unknown in authored equations. */
export function evaluate(source: string, x?: Value): EvaluationResult {
  try {
    const parser = new Parser(source);
    const expression = parser.parse();
    if (parser.peek()) throw new Error('These terms do not connect');
    const value = run(expression, x);
    if (!Number.isFinite(value.num) || Math.abs(value.num) > 1e6)
      throw new Error('This result is too large for the arena');
    return { valid: true, value, display: format(value) };
  } catch (error) {
    return { valid: false, display: '…', error: (error as Error).message };
  }
}

/** Display-only typography; parsing always uses the original source. */
export function notation(source: string): string {
  return source
    .replaceAll('^2', '²')
    .replaceAll('^3', '³')
    .replaceAll('*', '×')
    .replaceAll('/', '÷')
    .replaceAll('-', '−')
    .replaceAll('x', '𝑥');
}
