import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README documents explicit Chrome dashboard import and retained provider security boundaries", () => {
  const readme = readFileSync("README.md", "utf8");

  assert.match(readme, /Select that action in the app\. In its configuration panel, click \*\*Import session from Chrome\*\*\./);
  assert.match(readme, /never reads Chrome or Chrome Safe Storage during appearance, refresh, rotation,\s+settings, or wake handling/);
  assert.match(readme, /Dashboard session\s+cache data is stored through the dedicated local session store, never in Stream Deck\s+settings/);
  assert.match(readme, /does not expose cookies, provider URLs, or\s+Safe Storage secrets in settings, feedback, or logs/);
  assert.doesNotMatch(readme, /private HTTP collector/);

  assert.match(readme, /It does not read\s+Claude credentials or call a private usage endpoint/);
  assert.match(readme, /Codex\s+authentication remains inside the local Codex CLI and its app server/);
  assert.match(readme, /Experimental Grok authentication also remains inside the local Grok Build CLI/);
});
