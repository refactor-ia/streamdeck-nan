import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README documents API key setup and retained provider security boundaries", () => {
  const readme = readFileSync("README.md", "utf8");

  assert.match(readme, /In its configuration panel, paste your NaN API key and click \*\*Save API key\*\*\./);
  assert.match(readme, /API key is stored only in the macOS Keychain, never in Stream Deck\s+settings/);
  assert.match(readme, /never reads the key during appearance, refresh, rotation,\s+settings, or wake handling beyond the shared usage request/);
  assert.match(readme, /does not\s+expose the key, provider URLs, or\s+Keychain secrets in settings, feedback, or logs/);
  assert.doesNotMatch(readme, /Import session from Chrome|Chrome Safe Storage|imported (authenticated )?Chrome session|Google Chrome/);
  assert.doesNotMatch(readFileSync("PRIVACY.md", "utf8"), /cookie|Chrome|Safe Storage/i);
  assert.doesNotMatch(readme, /private HTTP collector/);

  assert.match(readme, /It does not read\s+Claude credentials or call a private usage endpoint/);
  assert.match(readme, /Codex\s+authentication remains inside the local Codex CLI and its app server/);
  assert.match(readme, /Experimental Grok authentication also remains inside the local Grok Build CLI/);
});
