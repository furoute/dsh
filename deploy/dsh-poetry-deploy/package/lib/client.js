// @deepseek-ai/dsh-poetry — Browser half.
// 诗泉侧边栏小插件：在侧边栏底部 Settings 上方加一个「诗词」按钮。面板含两个页签：
//   · 随机 —— 从 poetry.palemoky.com 在线 API 随机取一首中国古典诗词，支持按体裁、简繁。
//   · 搜索 —— 支持全文/标题/内容/作者分类搜索（/api/search?q=&type=），分页浏览结果；
//              作者模式下提供著名诗人快捷入口（经 /api/poems/random?author= 拉取，规避二字姓名
//              无法用 /api/search 检索的 3 字最短限制）。
// 数据全部来自公开在线 API，无需 host 参与。
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-poetry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		const API = "https://poetry.palemoky.com";
		const FAMOUS = [
			{ name: "李白" }, { name: "杜甫" }, { name: "白居易" },
			{ name: "苏轼" }, { name: "辛弃疾" }, { name: "李清照" },
			{ name: "王维" }, { name: "陆游" }
		];
		// /api/search 的 type 取值：all | title | content | author
		const MODES = [
			{ id: "all", label: "全文" },
			{ id: "title", label: "标题" },
			{ id: "content", label: "内容" },
			{ id: "author", label: "作者" }
		];
		const PAGE_SIZE = 6;

		function jsonGet(path) {
			return fetch(API + path, { headers: { accept: "application/json" }, cache: "no-store" })
				.then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
				.then((j) => (j && j.data !== void 0 ? j : Promise.reject(new Error("空响应"))));
		}

		// 随机诗词。
		function pickPoem(type, lang, author) {
			const q = [];
			if (author) q.push("author=" + encodeURIComponent(author));
			if (type) q.push("type=" + encodeURIComponent(type));
			q.push("lang=" + encodeURIComponent(lang));
			return jsonGet("/api/poems/random?" + q.join("&"));
		}

		function fmtLines(content) {
			if (Array.isArray(content)) return content;
			if (typeof content === "string" && content) return content.split(/\n|，。/).filter((s) => s.trim());
			return [];
		}
		function firstLine(content, n) {
			const L = fmtLines(content);
			return L.slice(0, n === void 0 ? 2 : n).join(" ");
		}

		function metaOf(poem) {
			return (poem.dynasty && poem.dynasty.name ? poem.dynasty.name : "") +
				(poem.author && poem.author.name ? " · " + poem.author.name : "");
		}
		function typeLabelOf(poem) {
			return poem && poem.type && poem.type.name ? poem.type.name : "";
		}

		// 随机视图（页签 1）。
		function RandomView(props) {
			const { lang, refreshKey } = props;
			const [poem, setPoem] = react.useState(null);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [type, setType] = react.useState("");

			const load = react.useCallback((t, l) => {
				setLoading(true); setError(null);
				pickPoem(t, l)
					.then((d) => { setPoem(d); setLoading(false); })
					.catch((e) => { setError(e && e.message || String(e)); setLoading(false); });
			}, []);

			react.useEffect(() => { load(type, lang); }, [refreshKey]);
			// eslint-disable-next-line react-hooks/exhaustive-deps

			return react.createElement(
				"div", { className: "dsh-poetry-view" },
				react.createElement(
					"div", { className: "dsh-poetry-view-row" },
					react.createElement(
						"select", {
							className: "dsh-poetry-type", value: type, "aria-label": "体裁筛选",
							onChange: (e) => { const v = e.target.value; setType(v); load(v, lang); }
						},
						["", "五言绝句", "七言绝句", "五言律诗", "七言律诗", "宋词", "元曲"]
							.map((t) => react.createElement("option", { key: t, value: t }, t || "随机体裁"))
					),
					react.createElement(
						"button", { type: "button", className: "dsh-poetry-btn dsh-poetry-btn-sm", onClick: () => load(type, lang), disabled: loading },
						loading ? "取诗中…" : "再来一首 ↻"
					)
				),
				react.createElement(
					"div", { className: "dsh-poetry-body-static" },
					loading && !poem ? react.createElement("p", { className: "dsh-poetry-note" }, "取诗中…")
						: error && !poem ? react.createElement("p", { className: "dsh-poetry-error", role: "alert" }, "读取失败：" + error)
							: poem ? react.createElement(PoemCard, { poem })
								: null
				)
			);
		}

		// 一首诗词的展示卡（随机与搜索结果点开共用）。
		function PoemCard(props) {
			const { poem } = props;
			const meta = metaOf(poem);
			const tag = typeLabelOf(poem);
			const lines = fmtLines(poem.content);
			return react.createElement(
				"div", { className: "dsh-poetry-card" },
				react.createElement("h4", { className: "dsh-poetry-poem-title" }, poem.title || "无题"),
				meta ? react.createElement("p", { className: "dsh-poetry-meta" }, meta) : null,
				tag ? react.createElement("span", { className: "dsh-poetry-tag" }, tag) : null,
				react.createElement(
					"div", { className: "dsh-poetry-lines" },
					lines.map((ln, i) => react.createElement("p", { key: i, className: "dsh-poetry-line" }, ln))
				)
			);
		}

		// 作者快捷：经 /api/poems/random?author= 拉取该诗人的作品，缓存成可翻页列表。
		function poetFeed(author, lang, want) {
			const jobs = [];
			for (let i = 0; i < want; i++) jobs.push(pickPoem("", lang, author));
			return Promise.all(jobs.map((p) => p.then((d) => d).catch(() => null))).then((arr) => {
				const seen = new Set(); const out = [];
				for (const it of arr) { if (!it) continue; const k = it.title + (it.content && it.content[0]); if (seen.has(k)) continue; seen.add(k); out.push(it); }
				return out;
			});
		}

		// 搜索视图（页签 2）。
		function SearchView(props) {
			const { lang } = props;
			const [mode, setMode] = react.useState("all");
			const [query, setQuery] = react.useState("");
			const [input, setInput] = react.useState("");
			const [results, setResults] = react.useState([]);
			const [expanded, setExpanded] = react.useState(null);
			const [page, setPage] = react.useState(1);
			const [hasMore, setHasMore] = react.useState(false);
			const [loading, setLoading] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [poetMode, setPoetMode] = react.useState(false);
			const [feed, setFeed] = react.useState([]);
			const [feedName, setFeedName] = react.useState("");
			const [matchedQ, setMatchedQ] = react.useState("");

			const runSearch = react.useCallback((m, q, pg) => {
				setLoading(true); setError(null); setPoetMode(false);
				// 在线 API 是「连续子串」精确匹配；若整句/整短语无命中，自动改用
				// 片段重试（串尾 3 字 → 串头 3 字），提升命中率。作者模式/翻页不做缩短。
				const doSearch = (sub, page) =>
					jsonGet("/api/search?q=" + encodeURIComponent(sub) + "&type=" + encodeURIComponent(m) + "&page=" + page + "&pageSize=" + PAGE_SIZE + "&lang=" + encodeURIComponent(lang))
						.then((j) => ({
							data: j.data || [],
							hasMore: !!j.pagination && !!j.pagination.hasMore,
							effective: sub
						}));
				const attempt = (sub, page) => doSearch(sub, page).then((r) => {
					if (r.data.length > 0) return r;
					if (m === "author" || page > 1) return r;
					const tail = sub.length > 3 ? sub.slice(-3) : sub;
					if (tail !== sub) return doSearch(tail, page).then((r2) => {
						if (r2.data.length > 0) return r2;
						const head = sub.length > 3 ? sub.slice(0, 3) : sub;
						if (head !== sub && head !== tail) return doSearch(head, page);
						return r2;
					});
					return r;
				});
				attempt(q, pg)
					.then((r) => {
						setResults(r.data); setHasMore(r.hasMore); setPage(pg); setExpanded(null);
						setMatchedQ(r.effective);
					})
					.catch((e) => { setError(e && e.message || String(e)); setResults([]); setHasMore(false); setMatchedQ(""); })
					.finally(() => setLoading(false));
			}, [lang]);

			const runPoet = react.useCallback((name) => {
				setLoading(true); setError(null); setPoetMode(true); setFeedName(name);
				poetFeed(name, lang, 8)
					.then((arr) => { setFeed(arr); setExpanded(null); if (arr.length === 0) setError("未取到" + name + "的作品");
						setLoading(false); })
					.catch((e) => { setError(e && e.message || String(e)); setFeed([]); setLoading(false); });
			}, [lang]);

			const submit = () => {
				const q = (input || "").trim();
				if (!q) { setError("请输入检索词"); return; }
				setQuery(q); runSearch(mode, q, 1);
			};

			// 结果列表 + 展开的诗词。
			function renderResults() {
				if (poetMode) {
					return react.createElement(
						"div", { className: "dsh-poetry-results" },
						react.createElement("p", { className: "dsh-poetry-results-hint" }, "“" + feedName + "”的作品（随机抽取）"),
						feed.length === 0 && !loading ? react.createElement("p", { className: "dsh-poetry-note" }, "暂无结果")
							: feed.map((poem) => react.createElement(ResultRow, {
								key: poem.id + poem.title, poem, expanded: expanded === poem.id,
								onToggle: () => setExpanded((x) => (x === poem.id ? null : poem.id))
							})),
						!loading && feed.length > 0 ? react.createElement(
							"div", { className: "dsh-poetry-pagebar" },
							react.createElement(
								"button", { type: "button", className: "dsh-poetry-ghost", onClick: () => runPoet(feedName) },
								"再来一批 ↻"
							)
						) : null
					);
				}
				return react.createElement(
					"div", { className: "dsh-poetry-results" },
					react.createElement("p", { className: "dsh-poetry-results-hint" },
						query ? "“" + query + "” 于“" + (MODES.find((m) => m.id === mode) || {}).label + "”的搜索结果" +
							(matchedQ && matchedQ !== query ? "（精确短语未命中，改用片段“" + matchedQ + "”）" : "") : "搜索诗词…"),
					loading ? react.createElement("p", { className: "dsh-poetry-note" }, "检索中…")
						: error ? react.createElement("p", { className: "dsh-poetry-error", role: "alert" }, "错误：" + error)
							: results.length === 0 ? react.createElement("p", { className: "dsh-poetry-note" }, "没有匹配的诗词" + (mode === "author" ? "（作者名需≥3字，或点击下方诗人便捷进入）" : ""))
								: react.createElement(
									"div", null,
									results.map((poem) => react.createElement(ResultRow, {
										key: poem.id + poem.title, poem, expanded: expanded === poem.id,
										onToggle: () => setExpanded((x) => (x === poem.id ? null : poem.id))
									})),
									react.createElement(
										"div", { className: "dsh-poetry-pagebar" },
										react.createElement(
											"button", { type: "button", className: "dsh-poetry-ghost", disabled: page <= 1,
												onClick: () => runSearch(mode, query, page - 1) },
											"‹ 上一页"
										),
										react.createElement("span", { className: "dsh-poetry-page" }, "第 " + page + " 页"),
										react.createElement(
											"button", { type: "button", className: "dsh-poetry-ghost", disabled: !hasMore,
												onClick: () => runSearch(mode, query, page + 1) },
											"下一页 ›"
										)
									)
								)
				);
			}

			return react.createElement(
				"div", { className: "dsh-poetry-view" },
				react.createElement(
					"div", { className: "dsh-poetry-catrow", role: "group", "aria-label": "搜索分类" },
					MODES.map((m) => react.createElement(
						"button", { key: m.id, type: "button",
							className: mode === m.id ? "dsh-poetry-cat is-active" : "dsh-poetry-cat",
							"aria-pressed": mode === m.id,
							onClick: () => setMode(m.id) },
						react.createElement("span", { className: "dsh-poetry-cat-label" }, m.label),
						react.createElement("span", { className: "dsh-poetry-cat-sub" }, m.id === "all" ? "全文" : m.id === "title" ? "标题" : m.id === "content" ? "内容" : "作者")
					))
				),
				react.createElement(
					"div", { className: "dsh-poetry-searchbar" },
					react.createElement(
						"input", {
							className: "dsh-poetry-input", type: "text", value: input, "aria-label": "检索词",
							placeholder: mode === "author" ? "输入作者名（≥3字）" : "输入关键词",
							onChange: (e) => setInput(e.target.value),
							onKeyDown: (e) => { if (e.key === "Enter") submit(); }
						}
					),
					react.createElement(
						"button", { type: "button", className: "dsh-poetry-btn dsh-poetry-btn-sm", onClick: submit },
						"搜索"
					)
				),
				mode === "author" ? react.createElement(
					"div", { className: "dsh-poetry-famous" },
					FAMOUS.map((f) => react.createElement(
						"button", { key: f.name, type: "button", className: "dsh-poetry-chip",
							onClick: () => { setInput(f.name); setQuery(f.name); runPoet(f.name); } },
						f.name
					))
				) : null,
				react.createElement("div", { className: "dsh-poetry-body-static" }, renderResults())
			);
		}

		function ResultRow(props) {
			const { poem, expanded, onToggle } = props;
			const meta = metaOf(poem);
			const tag = typeLabelOf(poem);
			if (expanded) {
				return react.createElement(
					"div", { className: "dsh-poetry-result dsh-poetry-result-open" },
					react.createElement(PoemCard, { poem }),
					react.createElement(
						"div", { className: "dsh-poetry-result-toggle" },
						react.createElement("button", { type: "button", className: "dsh-poetry-ghost", onClick: onToggle }, "收起 ▲")
					)
				);
			}
			return react.createElement(
				"div", { className: "dsh-poetry-result" },
				react.createElement(
					"button", { type: "button", className: "dsh-poetry-result-main", onClick: onToggle },
					react.createElement("div", { className: "dsh-poetry-result-head" },
						react.createElement("span", { className: "dsh-poetry-result-title" }, poem.title || "无题"),
						tag ? react.createElement("span", { className: "dsh-poetry-result-tag" }, tag) : null
					),
					meta ? react.createElement("div", { className: "dsh-poetry-result-meta" }, meta) : null,
					react.createElement("div", { className: "dsh-poetry-result-preview" }, firstLine(poem.content, 2))
				)
			);
		}

		// 面板根：页签切换（随机 / 搜索）。
		function PoetryPanel(props) {
			const { wide } = props;
			const [open, setOpen] = react.useState(false);
			const [tab, setTab] = react.useState("random");
			const [lang, setLang] = react.useState("zh-Hans");
			const [randKey, setRandKey] = react.useState(0);

			const panel = open ? react.createElement(
				"section", { className: "dsh-poetry-panel", "data-plugin": "@deepseek-ai/dsh-poetry", "aria-label": "诗泉" },
				react.createElement(
					"header", { className: "dsh-poetry-head" },
					react.createElement("span", { className: "dsh-poetry-title" }, "诗泉 · 诗词"),
					react.createElement(
						"div", { className: "dsh-poetry-head-actions" },
						react.createElement(
							"button", { type: "button", className: "dsh-poetry-ghost",
								onClick: () => setLang((prev) => (prev === "zh-Hans" ? "zh-Hant" : "zh-Hans")),
								title: "简/繁切换" },
							lang === "zh-Hans" ? "简" : "繁"
						),
						react.createElement(
							"button", { type: "button", className: "dsh-poetry-ghost dsh-poetry-close", onClick: () => setOpen(false), title: "关闭" },
							"×"
						)
					)
				),
				react.createElement(
					"div", { className: "dsh-poetry-tabs" },
					react.createElement(TabBtn, { active: tab === "random", label: "随机", onClick: () => setTab("random") }),
					react.createElement(TabBtn, { active: tab === "search", label: "搜索", onClick: () => setTab("search") })
				),
				react.createElement(
					"div", { className: "dsh-poetry-scroll" },
					tab === "random"
						? react.createElement(RandomView, { lang, refreshKey: lang + ":" + randKey })
						: react.createElement(SearchView, { lang })
				)
			) : null;

			const handle = react.createElement(
				"button", {
					type: "button", className: "dsh-poetry-badge", "data-active": open || void 0,
					"aria-label": "诗泉 · 诗词", "aria-expanded": open,
					onClick: () => setOpen((v) => { if (!v) setRandKey((k) => k + 1); return !v; })
				},
				react.createElement(primitives.IconListPenOutline16, { size: 18 }),
				wide ? react.createElement("span", { className: "dsh-poetry-badge-label" }, "诗词") : null
			);

			return react.createElement(
				"div", { className: wide ? "dsh-poetry-layer" : "dsh-poetry-layer dsh-poetry-rail" },
				[panel, react.createElement("div", { key: "actions", className: "dsh-poetry-actions" }, handle)]
			);
		}

		function TabBtn(props) {
			const { active, label, onClick } = props;
			return react.createElement(
				"button", { type: "button", className: active ? "dsh-poetry-tab is-active" : "dsh-poetry-tab", onClick },
				label
			);
		}

		const css =
			".dsh-poetry-layer{flex:none;align-items:center;width:100%;height:49px;margin:8px 0 0;display:flex;position:relative}" +
			".dsh-poetry-actions{align-items:center;width:100%;display:flex}" +
			".dsh-poetry-badge{width:100%;height:49px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;padding:0 8px 0 6px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}" +
			".dsh-poetry-badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}" +
			".dsh-poetry-badge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}" +
			".dsh-poetry-badge-label{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}" +
			".dsh-poetry-layer.dsh-poetry-rail{width:36px;height:36px;margin:2px 0}" +
			".dsh-poetry-layer.dsh-poetry-rail .dsh-poetry-badge{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}" +
			".dsh-poetry-layer.dsh-poetry-rail .dsh-poetry-actions{justify-content:center}" +
			".dsh-poetry-panel{z-index:30;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);width:440px;max-width:calc(100vw - 24px);max-height:74vh;box-shadow:var(--dsw-shadow-lv2);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border-radius:12px;flex-direction:column;display:flex;position:fixed;bottom:150px;left:12px;overflow:hidden}" +
			".dsh-poetry-head{box-sizing:border-box;border-bottom:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:10px 12px;display:flex}" +
			".dsh-poetry-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:20px}" +
			".dsh-poetry-head-actions{display:flex;align-items:center;gap:6px}" +
			".dsh-poetry-close{flex:none}" +
			".dsh-poetry-tabs{flex:none;display:flex;gap:4px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}" +
			".dsh-poetry-tab{background:0 0;border:none;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;font-size:13px;line-height:1;padding:8px 12px;border-radius:8px 8px 0 0}" +
			".dsh-poetry-tab:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
			".dsh-poetry-tab.is-active{color:var(--dsw-alias-state-business-primary);border-bottom-color:var(--dsw-alias-state-business-primary)}" +
			".dsh-poetry-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 14px 10px}" +
			".dsh-poetry-view{display:flex;flex-direction:column;gap:8px;padding-top:8px}" +
			".dsh-poetry-view-row{display:flex;align-items:center;gap:8px;justify-content:space-between}" +
			".dsh-poetry-searchbar{display:flex;align-items:center;gap:6px}" +
			".dsh-poetry-body-static{min-height:0}" +
			".dsh-poetry-note,.dsh-poetry-error,.dsh-poetry-results-hint{color:var(--dsw-alias-label-tertiary);margin:6px 0;font-size:12px;line-height:18px}" +
			".dsh-poetry-error{color:var(--dsw-alias-state-error-primary)}" +
			".dsh-poetry-ghost{background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;font-size:11px;line-height:1;padding:3px 7px}" +
			".dsh-poetry-ghost:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
			".dsh-poetry-ghost:disabled{opacity:.5;cursor:default}" +
			".dsh-poetry-type,.dsh-poetry-mode{background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1;padding:6px 6px;max-width:120px}" +
			".dsh-poetry-catrow{display:flex;gap:4px;background:var(--dsw-alias-bg-hover);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:3px}" +
			".dsh-poetry-cat{display:flex;flex-direction:column;align-items:center;flex:1;gap:1px;background:0 0;border:none;border-radius:7px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;padding:5px 6px}" +
			".dsh-poetry-cat:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
			".dsh-poetry-cat.is-active{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}" +
			".dsh-poetry-cat-label{font-size:13px;line-height:1.2;font-weight:600}" +
			".dsh-poetry-cat-sub{font-size:10px;line-height:1;opacity:.7}" +
			".dsh-poetry-input{flex:1;min-width:0;background:var(--dsw-alias-bg-hover);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1;padding:6px 8px}" +
			".dsh-poetry-btn{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;font-family:inherit;font-size:13px;line-height:1;padding:8px 16px}" +
			".dsh-poetry-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
			".dsh-poetry-btn:disabled{opacity:.55;cursor:default}" +
			".dsh-poetry-btn-sm{padding:6px 12px;font-size:12px;flex:none}" +
			".dsh-poetry-card{display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px;padding:8px 0}" +
			".dsh-poetry-poem-title{color:var(--dsw-alias-label-primary);margin:4px 0 0;font-size:16px;font-weight:600;line-height:24px}" +
			".dsh-poetry-meta{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;line-height:18px}" +
			".dsh-poetry-tag{color:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:1px 8px;font-size:11px;line-height:16px;display:inline-block;margin-top:2px}" +
			".dsh-poetry-lines{display:flex;flex-direction:column;align-items:center;gap:2px;margin-top:14px}" +
			".dsh-poetry-line{color:var(--dsw-alias-label-primary);margin:0;font-family:'Noto Serif SC','Songti SC','SimSun',serif;font-size:16px;line-height:1.9;letter-spacing:0.02em}" +
			".dsh-poetry-famous{display:flex;flex-wrap:wrap;gap:6px}" +
			".dsh-poetry-chip{background:0 0;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:12px;line-height:1;padding:5px 10px}" +
			".dsh-poetry-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
			".dsh-poetry-results{display:flex;flex-direction:column;gap:6px}" +
			".dsh-poetry-result{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}" +
			".dsh-poetry-result-main{width:100%;text-align:left;background:0 0;border:none;color:inherit;cursor:pointer;font-family:inherit;padding:8px 10px}" +
			".dsh-poetry-result-main:hover{background:var(--dsw-alias-interactive-bg-hover)}" +
			".dsh-poetry-result-head{display:flex;align-items:center;gap:8px}" +
			".dsh-poetry-result-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;line-height:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
			".dsh-poetry-result-tag{flex:none;color:var(--dsw-alias-state-business-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:0 6px;font-size:10px;line-height:16px}" +
			".dsh-poetry-result-meta{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;margin-top:1px}" +
			".dsh-poetry-result-preview{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;margin-top:2px;overflow:hidden}" +
			".dsh-poetry-result-open{padding:8px 10px}" +
			".dsh-poetry-result-toggle{display:flex;justify-content:center;padding-top:6px}" +
			".dsh-poetry-pagebar{display:flex;align-items:center;justify-content:center;gap:10px;padding-top:4px}" +
			".dsh-poetry-page{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1}";
		const tagId = "@deepseek-ai/dsh-poetry/panel.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-poetry";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "poetry.palemoky",
				order: 3
			}, PoetryPanel));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
