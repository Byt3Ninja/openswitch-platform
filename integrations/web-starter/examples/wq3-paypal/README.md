# Optional WQ3 PayPal example

This is optional merchant configuration, not a generic checkout default or a verified runnable provider fixture. For the separately approved WQ3 sandbox PayPal/EUR scenario, an administrator must provide the actual WQ3 test merchant/profile and matching keys, confirm PayPal sandbox account/connector/routing and supported EUR amount, and review the permitted return origin. No merchant ID, profile ID, credentials or approved amount is embedded here.

Use the generic `config.example.env` with the separately provisioned values and put the reviewed EUR minor-unit amount in the server catalog. PayPal eligibility must come from the configured connector and payment context; do not fork browser code to force a PayPal list. For EUR, integer 100 represents EUR1.00, but this example does not authorize that or any other payment amount.

The prior approval for one WQ3 EUR sandbox payment is not authorization for additional payments, arbitrary provider tests, live credentials or production changes. No new WQ3/PayPal transaction was run for this generic starter. Success/failure/cancellation, redirects, authoritative status and signed webhooks need separately evidenced acceptance. The preserved `OpenSwitch-WQ3-SDK-Starter-2026-10-02.zip` is superseded for new integrations by this starter; it was not deleted or overwritten.
