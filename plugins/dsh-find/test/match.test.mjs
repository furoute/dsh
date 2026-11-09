// dsh-find matcher tests (node --test, zero dependencies).
//
// Loads lib/client.js in a vm with a stubbed window and pulls out the pure
// matcher (exports.findMatches) — no DOM needed.
//
// Fixtures:
// - Thai sentence from Job Natdhanai, deepseek-ai/deepseek-harness#1999:
//   unicode61 shreds 'ช่วยวิเคราะห์คดีอาญานี้หน่อย' into fragments and a direct
//   lookup for "คดีอาญา" returns 0 hits on the FTS index. Substring matching
//   must still find it (regression test for Thai coverage).
// - Chinese: the #8713 case (tkm) — in-session Ctrl+F must find Chinese keywords
//   that the FTS tokenizer treats as one token.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(path.join(here, "..", "lib", "client.js"), "utf8");

function loadMatcher() {
	let factory = null;
	const sandbox = {
		window: {
			__ModuleLoader__: {
				load(def) {
					factory = def.factory;
				}
			}
		},
		console
	};
	vm.createContext(sandbox);
	vm.runInContext(clientSrc, sandbox, { filename: "client.js" });
	assert.ok(factory, "client.js should register via window.__ModuleLoader__.load");
	const mod = factory();
	assert.equal(typeof mod.findMatches, "function", "factory should export findMatches");
	// Spread into a host-realm array: values created inside the vm have a
	// different Array prototype, which assert.deepStrictEqual would reject.
	return (...args) => [...mod.findMatches(...args)];
}

const findMatches = loadMatcher();

test("Thai: Job Natdhanai #1999 reproduction finds the word the FTS index misses", () => {
	const sentence = "ช่วยวิเคราะห์คดีอาญานี้หน่อย";
	assert.deepEqual(findMatches(sentence, "คดีอาญา"), [13]);
	assert.deepEqual(findMatches(sentence, "วิเคราะห์"), [4]);
	assert.deepEqual(findMatches(sentence, sentence), [0]);
});

test("Chinese: #8713 in-session find matches CJK keywords", () => {
	assert.deepEqual(findMatches("在当前会话中查找会话内容", "会话"), [3, 8]);
});

test("matching is case-insensitive and non-overlapping; empty query matches nothing", () => {
	assert.deepEqual(findMatches("Hello hello HELLO", "hello"), [0, 6, 12]);
	assert.deepEqual(findMatches("aaa", "aa"), [0]);
	assert.deepEqual(findMatches("some text", ""), []);
	assert.deepEqual(findMatches("some text", "   "), []);
	assert.deepEqual(findMatches("some text", "missing"), []);
});
