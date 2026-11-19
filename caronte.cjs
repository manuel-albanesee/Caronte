#!/usr/bin/env node

const usage = 'Usage: caronte install-project [--dry-run | --verify] [--ecc-full]\n' +
  'Installs Caronte in the current directory.';
const [command, ...flags] = process.argv.slice(2);

if (!command || command === '--help' || command === '-h' ||
    (command === 'install-project' && flags.some(flag => flag === '--help' || flag === '-h'))) {
  console.log(usage);
} else if (command !== 'install-project' || flags.some(flag => !flag.startsWith('--'))) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const { cli } = require('./install.cjs');
    cli([process.cwd(), ...flags]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
