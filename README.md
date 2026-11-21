# Place Converter

Live exchange rates for the **Place (PLC)**, the most stable currency in the office.

A single static page with no build step and no dependencies:

- Converts Place to and from about 30 real currencies (EUR by default). You can type in either field and swap the direction.
- Shows a live rate that ticks every couple of seconds, plus the 24h change.
- Has a trend chart for 1D / 1W / 1M / 3M / 1Y, with hover tooltips.
- Light and dark themes: follows the system setting by default, with a toggle (remembered per browser) in the top right. Works on phones.

## How the rates work

- **Real currencies:** European Central Bank reference rates from the free [Frankfurter](https://frankfurter.dev) API (no API key). If the API can't be reached, the page uses a built-in snapshot.
- **Place:** pinned at **1 PLC = 4.3343 EUR**. The page opens at exactly that value, then the rate wobbles by at most ±0.00002 EUR, so the chart keeps moving but the displayed (rounded) rate never changes.

## Tweaking the joke

Edit the `PLACE` block at the top of [`app.js`](app.js):

```js
const PLACE = {
  name: 'Place',
  code: 'PLC',
  rateEur: 4.3343,       // 1 Place in EUR, shown on page load
  wobble: 0.00002,       // max drift from rateEur (keeps the rounded rate fixed)
  genesis: '2024-01-01', // first trading day
  seed: 'place',         // change for a different wobble
};
```

`DEFAULT_CURRENCY` and `DEFAULT_RANGE` sit right below it.

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish on GitHub Pages

1. Push this repo to GitHub.
2. In the repo, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then branch `main` and folder `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/place-converter/`.
