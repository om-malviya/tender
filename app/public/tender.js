/*
 * Tender checkout widget: the drop-in piece a shop adds with one <script> tag.
 *
 *   <script src="https://<tender-app>/tender.js"></script>
 *   Tender.checkout({ chain, invoiceId, onPaid(txHash) {...}, onClose() {...} })
 *
 * Opens the Tender pay page in a POPUP (not an iframe: browser wallets like MetaMask don't inject into
 * cross-origin iframes). When the payment confirms, the pay page posts a message back; we only accept
 * messages from the Tender app's own origin. The shop should still confirm the payment on-chain.
 */
(function () {
  var script = document.currentScript;
  var defaultAppUrl = script ? new URL(script.src).origin : "";

  function checkout(opts) {
    var appUrl = (opts.appUrl || defaultAppUrl).replace(/\/$/, "");
    var appOrigin = new URL(appUrl).origin;
    var url = appUrl + "/pay/" + encodeURIComponent(opts.chain) + "/" + encodeURIComponent(opts.invoiceId) + "?embed=1";
    var popup = window.open(url, "tender-checkout", "width=1040,height=780");
    if (!popup) {
      // popup blocked: fall back to a normal tab
      window.location.href = url.replace("?embed=1", "");
      return;
    }

    function onMessage(e) {
      if (e.origin !== appOrigin) return; // ignore messages from anywhere else
      var d = e.data || {};
      if (d.type === "tender:paid" && String(d.invoiceId) === String(opts.invoiceId)) {
        done();
        if (opts.onPaid) opts.onPaid(d.txHash);
      }
    }
    var watcher = setInterval(function () {
      if (popup.closed) {
        done();
        if (opts.onClose) opts.onClose();
      }
    }, 500);
    function done() {
      clearInterval(watcher);
      window.removeEventListener("message", onMessage);
    }
    window.addEventListener("message", onMessage);
  }

  window.Tender = { checkout: checkout };
})();
