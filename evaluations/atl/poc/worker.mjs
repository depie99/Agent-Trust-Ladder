import { evaluate } from './run.mjs';

// One condition per child process. The parent enforces time and output bounds.
const [condition, runRoot] = process.argv.slice(2);
console.log(JSON.stringify(await evaluate(condition, runRoot)));
