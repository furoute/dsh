// @deepseek-ai/dsh-work-mode — browser half.
//
// 工作模式切换器：在「办公」与「代码」之间即时切换。
// 写入的是 DSH 前端的三个偏好 + onboarding 的 purpose 记录：
//   ui-chat   transcriptView   compact | standard
//   ui-chat   performanceUsage compact | detailed
//   ui-settings  developerTools enabled
//   ui-settings-account purpose  office | development | both
// 全部通过 configForms 服务写入 Host 并即时生效，不需要重启会话，
// 刷新页面后也与引导向导里选择的结果一致。
window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-work-mode",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var react = require("react");

		var ACCOUNT_NS = "ui-settings-account";
		var CHAT_NS = "ui-chat";

		var MODES = [
			{ id: "office", label: "办公", dot: "#f5a623", hint: "紧凑对话视图 · 简洁用量显示 · 关闭开发者工具" },
			{ id: "development", label: "代码", dot: "#4a9eff", hint: "标准对话视图 · 详细用量显示 · 开启开发者工具" },
			{ id: "both", label: "两者", dot: "#8b6cff", hint: "兼顾办公与代码，按代码偏好显示" }
		];

		function modeInfo(id) {
			for (var i = 0; i < MODES.length; i++) if (MODES[i].id === id) return MODES[i];
			return MODES[1];
		}

		function currentMode(purpose) {
			if (purpose === "office" || purpose === "development" || purpose === "both") return purpose;
			return "development";
		}

		function useScopeValue(scope, pick) {
			var subscribe = react.useCallback(
				function (callback) {
					return scope.subscribe(callback);
				},
				[scope]
			);
			var read = react.useCallback(
				function () {
					return pick(scope.getSnapshot());
				},
				[scope, pick]
			);
			return react.useSyncExternalStore(subscribe, read, read);
		}

		/**
		 * 写入目标模式的全部偏好。顺序：先写界面偏好（即时生效），
		 * 再写开发者工具开关，最后记录 purpose（供引导向导识别）。
		 */
		async function applyMode(ctx, mode) {
			var office = mode === "office";
			var chat = ctx.configForms.get(CHAT_NS);
			var account = ctx.configForms.get(ACCOUNT_NS);
			var accepted = await chat.mutate([
				{ op: "set", path: ["transcriptView"], value: office ? "compact" : "standard" },
				{ op: "set", path: ["performanceUsage"], value: office ? "compact" : "detailed" }
			]);
			if (!accepted) throw new Error("对话偏好写入失败");
			await ctx.configForms.developerTools.setEnabled(!office);
			var saved = await account.set("purpose", mode);
			if (!saved) throw new Error("模式记录写入失败");
		}

		/** 输入框下方的小胶囊：显示当前模式，点击在办公/代码之间切换。 */
		function WorkModeDock(props) {
			var purpose = useScopeValue(props.account, function (snapshot) {
				return snapshot.value ? snapshot.value.purpose : null;
			});
			var mode = currentMode(purpose);
			var info = modeInfo(mode);
			var busyState = react.useState(false);
			var busy = busyState[0];
			var setBusy = busyState[1];
			var errorState = react.useState(null);
			var error = errorState[0];
			var setError = errorState[1];

			var toggle = function () {
				if (busy) return;
				var next = mode === "office" ? "development" : "office";
				setBusy(true);
				setError(null);
				applyMode(props.ctx, next)
					.catch(function (cause) {
						setError(String((cause && cause.message) || cause));
					})
					.finally(function () {
						setBusy(false);
					});
			};

			return react.createElement(
				"button",
				{
					type: "button",
					className: "dsh-workmode-chip" + (busy ? " is-busy" : ""),
					title: "点击切换：" + (mode === "office" ? "代码模式" : "办公模式") + "（当前：" + info.hint + "）",
					onClick: toggle
				},
				react.createElement("span", { className: "dsh-workmode-dot", style: { background: info.dot } }),
				react.createElement("span", { className: "dsh-workmode-chip-label" }, info.label + "模式"),
				error ? react.createElement("span", { className: "dsh-workmode-error" }, "!" + error) : null
			);
		}

		/** 设置 → 通用 里的完整三选一行。 */
		function WorkModeRow(props) {
			var purpose = useScopeValue(props.account, function (snapshot) {
				return snapshot.value ? snapshot.value.purpose : null;
			});
			var mode = currentMode(purpose);
			var busyState = react.useState(false);
			var busy = busyState[0];
			var setBusy = busyState[1];
			var errorState = react.useState(null);
			var error = errorState[0];
			var setError = errorState[1];

			var choose = function (next) {
				if (busy || next === mode) return;
				setBusy(true);
				setError(null);
				applyMode(props.ctx, next)
					.catch(function (cause) {
						setError(String((cause && cause.message) || cause));
					})
					.finally(function () {
						setBusy(false);
					});
			};

			return react.createElement(
				"div",
				{ className: "dsh-workmode-row" },
				react.createElement("div", { className: "dsh-workmode-row-text" },
					react.createElement("div", { className: "dsh-workmode-row-title" }, "工作模式"),
					react.createElement("div", { className: "dsh-workmode-row-desc" },
						"切换办公 / 代码的界面偏好：对话视图、" + "用量显示与开发者工具。立即生效，无需重启。")
				),
				react.createElement("div", { className: "dsh-workmode-row-actions" },
					MODES.map(function (item) {
						return react.createElement("button", {
							key: item.id,
							type: "button",
							disabled: busy,
							className: "dsh-workmode-btn" + (mode === item.id ? " is-active" : ""),
							title: item.hint,
							onClick: function () { choose(item.id); }
						}, item.label);
					}),
					error ? react.createElement("span", { className: "dsh-workmode-error" }, error) : null
				)
			);
		}

		function injectStyle() {
			var id = "@deepseek-ai/dsh-work-mode/style";
			if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(id) + "]") !== null) return;
			var css =
				"@plugin-css{display:none}" +
				".dsh-workmode-chip{display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:2px 8px;" +
				"border:1px solid rgba(127,127,127,.32);border-radius:999px;background:transparent;color:inherit;" +
				"font:12px/1.5 system-ui,'Microsoft YaHei',sans-serif;cursor:pointer;opacity:.85;transition:opacity .15s,background .15s}" +
				".dsh-workmode-chip:hover{opacity:1;background:rgba(127,127,127,.12)}" +
				".dsh-workmode-chip.is-busy{opacity:.5;cursor:progress}" +
				".dsh-workmode-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;box-shadow:0 0 0 2px rgba(0,0,0,.06)}" +
				".dsh-workmode-chip-label{white-space:nowrap}" +
				".dsh-workmode-error{color:#e5484d;font-size:11px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
				".dsh-workmode-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;width:100%}" +
				".dsh-workmode-row-text{min-width:0}" +
				".dsh-workmode-row-title{font-size:13px;color:var(--dsw-alias-label-primary,#eee)}" +
				".dsh-workmode-row-desc{font-size:12px;color:var(--dsw-alias-label-secondary,#999);margin-top:2px;max-width:520px}" +
				".dsh-workmode-row-actions{display:flex;align-items:center;gap:6px;flex:0 0 auto}" +
				".dsh-workmode-btn{padding:4px 12px;border-radius:6px;border:1px solid rgba(127,127,127,.35);background:transparent;" +
				"color:inherit;font:12px/1.6 system-ui,'Microsoft YaHei',sans-serif;cursor:pointer}" +
				".dsh-workmode-btn:hover{background:rgba(127,127,127,.14)}" +
				".dsh-workmode-btn.is-active{background:var(--dsw-alias-label-primary,#eee);color:var(--dsw-alias-label-primary-inverted,#111);border-color:transparent;font-weight:600}" +
				".dsh-workmode-btn:disabled{opacity:.6;cursor:progress}";
			var tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-work-mode";
			tag.dataset.pluginCss = id;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const inject = ["slots", "configForms"];

		function apply(ctx) {
			injectStyle();
			var account = ctx.configForms.get(ACCOUNT_NS);
			ctx.slots.inject("conversation.composer.dock", function () {
				return ctx.slots.register({
					name: "conversation.composer.dock",
					id: "work-mode.dock",
					order: 3
				}, function () {
					return react.createElement(WorkModeDock, { ctx: ctx, account: account });
				});
			});
			ctx.slots.inject("settings.general.item", function () {
				return ctx.slots.register({
					name: "settings.general.item",
					id: "work-mode",
					order: 14
				}, function () {
					return react.createElement(WorkModeRow, { ctx: ctx, account: account });
				});
			});
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
