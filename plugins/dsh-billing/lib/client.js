window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-billing",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		// The billing readout: 充值余额 (recharge balance) + 今日消费 (today's spend).
		// The host half serves /billing/data JSON; this dock polls it.
		function fmt(n) {
			if (typeof n !== "number" || !Number.isFinite(n)) return "0.00";
			return n.toFixed(2);
		}
		function BillingDock() {
			const [data, setData] = react.useState(null);
			(0, react.useEffect)(() => {
				let alive = true;
				const refresh = () => {
					fetch("/billing/data", { cache: "no-store" })
						.then((r) => (r.ok ? r.json() : null))
						.then((d) => {
							if (alive && d) setData(d);
						})
						.catch(() => {});
				};
				refresh();
				const timer = setInterval(refresh, 20000);
				return () => { alive = false; clearInterval(timer); };
			}, []);

			const balance = data && data.balance;
			const consumption = data && data.consumption;
			const isCny = (balance && balance.currency === "CNY") || (consumption && consumption.currency === "CNY");
			const cur = isCny ? "\u00a5" : "\u00a5";
			const toppedUp = balance && balance.toppedUp != null ? parseFloat(balance.toppedUp) : null;
			const cons = consumption && consumption.cny != null ? consumption.cny : 0;

			return (0, react.createElement)(
				"span",
				{ className: "dsh-billing", "data-plugin": "@deepseek-ai/dsh-billing" },
				(0, react.createElement)("span", { className: "dsh-billing-item" },
					(0, react.createElement)("span", { className: "dsh-billing-label" }, "\u5145\u503c\u4f59\u989d"),
					(0, react.createElement)("span", { className: "dsh-billing-value" }, toppedUp == null ? "\u2026" : cur + fmt(toppedUp))
				),
				(0, react.createElement)("span", { className: "dsh-billing-item" },
					(0, react.createElement)("span", { className: "dsh-billing-label" }, "\u4eca\u65e5\u6d88\u8d39"),
					(0, react.createElement)("span", { className: "dsh-billing-value" }, cur + fmt(cons))
				)
			);
		}
		// Inject the CSS for the dock readout (scoped under the plugin data attribute).
		const css =
			"[data-plugin='@deepseek-ai/dsh-billing'].dsh-billing{display:inline-flex;align-items:baseline;gap:16px;font-size:12px;margin-left:8px}" +
			".dsh-billing-item{display:inline-flex;align-items:baseline;gap:6px}" +
			".dsh-billing-label{color:var(--dsw-alias-label-secondary)}" +
			".dsh-billing-value{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-weight:600}";
		const tagId = "@deepseek-ai/dsh-billing/dock.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-billing";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
				name: "conversation.composer.dock",
				id: "billing.dsh",
				order: 2
			}, BillingDock));
		}
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
