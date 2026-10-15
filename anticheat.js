// Easy Anti-Cheat (EOS) status for the desktop app.
//
// EAC is off until it's wired up. Turn it on with "eac": { "enabled": true } in package.json
// (or CAKE_EAC=1 for testing). When it's on and anything goes wrong, the game shows an error
// screen and refuses to play instead of quietly running unprotected.
//
// TODO(eac): replace the placeholder below with the real EOS SDK native add-on once we have it.

const path = require('path');
const pkg = require('./package.json');

const ERRORS = {
  EAC_NOT_LOADED: "Easy Anti-Cheat couldn't be loaded. Try reinstalling Cake Defense.",
  EAC_NOT_LAUNCHED: 'Easy Anti-Cheat is not running. Start Cake Defense from its launcher.',
  EAC_INIT_FAILED: "Easy Anti-Cheat couldn't start.",
};

function fail(code, detail) {
  return { enabled: true, ok: false, code, message: ERRORS[code], detail: detail || '' };
}

function initAntiCheat() {
  const enabled = process.env.CAKE_EAC === '1' || !!pkg.eac?.enabled;
  if (!enabled) return { enabled: false, ok: true };

  let native;
  try {
    native = require(path.join(__dirname, 'native', 'eos_anticheat.node'));
  } catch (err) {
    return fail('EAC_NOT_LOADED', err.code || err.message);
  }
  try {
    const result = native.init();
    if (!result?.ok) return fail(result?.notLaunched ? 'EAC_NOT_LAUNCHED' : 'EAC_INIT_FAILED', result?.error);
  } catch (err) {
    return fail('EAC_INIT_FAILED', err.message);
  }
  return { enabled: true, ok: true };
}

module.exports = { initAntiCheat };
