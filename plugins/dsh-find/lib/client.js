// @deepseek-ai/dsh-find — browser half.
// Adds a browser-style "find in conversation" bar: Ctrl+F opens it, Enter / Shift+Enter
// (or F3 / Shift+F3) walks the matches, Esc closes. Matching is plain text-level
// (substring), so Chinese keywords work — unlike the built-in FTS tokenizer, which
// treats a run of Chinese characters as one token.
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-find",
	factory: () => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var BAR_ATTR = "data-dsh-find";
		var HIGHLIGHT_ALL = "dsh-find-all";
		var HIGHLIGHT_ACTIVE = "dsh-find-active";
		var supportsHighlights =
			typeof CSS !== "undefined" && CSS.highlights !== undefined && typeof Highlight === "function";

		var state = { open: false, query: "", ranges: [], index: 0, input: null, count: null, bar: null };
		var installed = false;
		var inputTimer = 0;
		var refreshTimer = 0;

		function injectStyle() {
			if (document.querySelector('style[data-plugin-css="@deepseek-ai/dsh-find/style"]') !== null) return;
			var css =
				"[" + BAR_ATTR + "]{position:fixed;z-index:2147483000;display:flex;gap:8px;align-items:center;" +
				"padding:6px 10px;border-radius:999px;background:var(--dsw-alias-bg-elevated,#22222a);color:var(--dsw-alias-label-primary,#eee);" +
				"border:1px solid rgba(127,127,127,.28);box-shadow:0 10px 30px rgba(0,0,0,.45);" +
				"font:13px/1.3 system-ui,'Microsoft YaHei',sans-serif;backdrop-filter:blur(6px)}" +
				"[" + BAR_ATTR + "][hidden]{display:none}" +
				"[" + BAR_ATTR + "] .icon{flex:0 0 auto;opacity:.65;display:flex}" +
				"[" + BAR_ATTR + "] input{width:200px;padding:3px 2px;border:0;background:transparent;color:inherit;outline:none;font:inherit}" +
				"[" + BAR_ATTR + "] .divider{width:1px;height:16px;background:rgba(127,127,127,.35);flex:0 0 auto}" +
				"[" + BAR_ATTR + "] button{border:0;background:transparent;color:inherit;cursor:pointer;font-size:13px;padding:3px 6px;border-radius:999px}" +
				"[" + BAR_ATTR + "] button:hover{background:rgba(127,127,127,.22)}" +
				"[" + BAR_ATTR + "] button.close{font-size:15px;line-height:1;padding:3px 7px}" +
				"[" + BAR_ATTR + "] button.close:hover{background:rgba(255,90,90,.25)}" +
				"[" + BAR_ATTR + "] .count{min-width:44px;text-align:center;opacity:.75;font-variant-numeric:tabular-nums;font-size:12px}" +
				"::highlight(" + HIGHLIGHT_ALL + "){background:#ffd54f;color:#1a1a1a}" +
				"::highlight(" + HIGHLIGHT_ACTIVE + "){background:#ff9100;color:#1a1a1a}";
			var tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-find";
			tag.dataset.pluginCss = "@deepseek-ai/dsh-find/style";
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		function buildBar() {
			var bar = document.createElement("div");
			bar.setAttribute(BAR_ATTR, "");
			bar.hidden = true;
			bar.innerHTML =
				'<span class="icon" aria-hidden="true">' +
				'<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6">' +
				'<circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5 14 14"></path></svg></span>' +
				'<input type="text" spellcheck="false" placeholder="在当前会话中查找…" title="Enter 下一处 / Shift+Enter 上一处 / Esc 关闭" />' +
				'<span class="count">0/0</span>' +
				'<span class="divider"></span>' +
				'<button data-act="prev" title="上一处（Shift+Enter）">\u25b2</button>' +
				'<button data-act="next" title="下一处（Enter）">\u25bc</button>' +
				'<button class="close" data-act="close" title="关闭（Esc）" aria-label="关闭查找">\u2715</button>';
			document.body.appendChild(bar);

			state.bar = bar;
			state.input = bar.querySelector("input");
			state.count = bar.querySelector(".count");

			state.input.addEventListener("input", () => {
				window.clearTimeout(inputTimer);
				inputTimer = window.setTimeout(() => {
					state.query = state.input.value;
					runSearch(false);
				}, 120);
			});
			state.input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					reveal(state.index + (event.shiftKey ? -1 : 1));
				}
			});
			bar.addEventListener("click", (event) => {
				var el = event.target && event.target.closest ? event.target.closest("[data-act]") : null;
				var act = el && el.getAttribute ? el.getAttribute("data-act") : null;
				if (act === "next") reveal(state.index + 1);
				else if (act === "prev") reveal(state.index - 1);
				else if (act === "close") closeBar();
			});
		}

		/** Conversation region when we can find it, otherwise the whole document. */
		function scope() {
			return (
				document.querySelector('[data-slot="conversation.session"]') ||
				document.querySelector('[data-slot^="conversation"]') ||
				document.body
			);
		}

		/**
		 * Keep the bar inside the conversation area and below the window controls.
		 * The desktop window draws minimize/maximize/close in the top strip, so the bar
		 * must never sit there (it would be covered by those buttons).
		 */
		function placeBar() {
			if (!state.bar) return;
			var el = scope();
			var rect = el && el !== document.body && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
			if (rect && rect.width > 260) {
				state.bar.style.transform = "translateX(-50%)";
				state.bar.style.left = Math.round(rect.left + rect.width / 2) + "px";
				state.bar.style.right = "auto";
				state.bar.style.top = Math.max(Math.round(rect.top) + 12, 52) + "px";
			} else {
				state.bar.style.transform = "none";
				state.bar.style.left = "auto";
				state.bar.style.right = "24px";
				state.bar.style.top = "56px";
			}
		}

		function isOurs(node) {
			var el = node && node.nodeType === 1 ? node : node && node.parentElement;
			return !!(el && el.closest && el.closest("[" + BAR_ATTR + "]"));
		}

		function textNodes() {
			var nodes = [];
			var walker = document.createTreeWalker(scope(), NodeFilter.SHOW_TEXT, {
				acceptNode: (node) => {
					if (!node.nodeValue || node.nodeValue.trim() === "") return NodeFilter.FILTER_REJECT;
					if (isOurs(node)) return NodeFilter.FILTER_REJECT;
					return NodeFilter.FILTER_ACCEPT;
				}
			});
			var node;
			while ((node = walker.nextNode())) nodes.push(node);
			return nodes;
		}

		function computeRanges(query) {
			var ranges = [];
			var trimmed = query.trim();
			if (trimmed === "") return ranges;
			var needle = trimmed.toLowerCase();
			var nodes = textNodes();
			for (var i = 0; i < nodes.length; i++) {
				var text = nodes[i].nodeValue;
				var haystack = text.toLowerCase();
				if (haystack.length !== text.length) haystack = text;
				var from = 0;
				var at;
				while ((at = haystack.indexOf(needle, from)) >= 0) {
					var range = document.createRange();
					range.setStart(nodes[i], at);
					range.setEnd(nodes[i], at + trimmed.length);
					ranges.push(range);
					from = at + (trimmed.length || 1);
				}
			}
			return ranges;
		}

		function updateCount() {
			if (!state.count) return;
			state.count.textContent = state.ranges.length === 0 ? "0/0" : state.index + 1 + "/" + state.ranges.length;
		}

		function paint() {
			if (!supportsHighlights) return;
			var all = new Highlight();
			var active = new Highlight();
			for (var i = 0; i < state.ranges.length; i++) {
				if (i === state.index) active.add(state.ranges[i]);
				else all.add(state.ranges[i]);
			}
			CSS.highlights.set(HIGHLIGHT_ALL, all);
			CSS.highlights.set(HIGHLIGHT_ACTIVE, active);
		}

		function clearPaint() {
			if (!supportsHighlights) return;
			CSS.highlights.delete(HIGHLIGHT_ALL);
			CSS.highlights.delete(HIGHLIGHT_ACTIVE);
		}

		function reveal(index, scroll) {
			if (state.ranges.length === 0) return;
			var total = state.ranges.length;
			state.index = ((index % total) + total) % total;
			paint();
			updateCount();
			if (scroll === false) return;
			var node = state.ranges[state.index].startContainer;
			var el = node.nodeType === 1 ? node : node.parentElement;
			if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
		}

		function runSearch(keepIndex) {
			state.ranges = computeRanges(state.query);
			if (!keepIndex || state.ranges.length === 0) state.index = 0;
			if (state.index >= state.ranges.length) state.index = 0;
			paint();
			updateCount();
			if (state.ranges.length > 0) reveal(state.index);
		}

		function openBar() {
			state.open = true;
			placeBar();
			state.bar.hidden = false;
			state.input.focus();
			state.input.select();
			state.query = state.input.value;
			placeBar();
			runSearch(true);
		}

		function closeBar() {
			state.open = false;
			state.bar.hidden = true;
			state.ranges = [];
			state.index = 0;
			clearPaint();
			updateCount();
		}

		function onKeyDown(event) {
			var isFind = (event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "f" || event.key === "F");
			if (isFind) {
				event.preventDefault();
				event.stopPropagation();
				openBar();
				return;
			}
			if (event.key === "F3") {
				event.preventDefault();
				if (state.open) reveal(state.index + (event.shiftKey ? -1 : 1));
				else openBar();
				return;
			}
			if (!state.open) return;
			if (event.key === "Escape") {
				event.preventDefault();
				closeBar();
				return;
			}
			if (event.key === "Enter" && event.target !== state.input) {
				event.preventDefault();
				reveal(state.index + (event.shiftKey ? -1 : 1));
			}
		}

		function scheduleRefresh() {
			window.clearTimeout(refreshTimer);
			refreshTimer = window.setTimeout(() => {
				if (state.open && state.query.trim() !== "") runSearch(true);
			}, 400);
		}

		function install() {
			if (installed || typeof document === "undefined" || document.body === null) return;
			installed = true;
			injectStyle();
			buildBar();
			document.addEventListener("keydown", onKeyDown, true);
			window.addEventListener("resize", placeBar);
			window.addEventListener("scroll", placeBar, true);
			new MutationObserver((records) => {
				for (var i = 0; i < records.length; i++) {
					if (!isOurs(records[i].target)) {
						scheduleRefresh();
						return;
					}
				}
			}).observe(document.body, { childList: true, subtree: true, characterData: true });
		}

		function apply() {
			if (typeof document === "undefined") return;
			if (document.body !== null) install();
			else document.addEventListener("DOMContentLoaded", install, { once: true });
		}

		exports.apply = apply;
		exports.inject = [];
		return module.exports;
	}
});
