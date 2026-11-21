# Place Converter

Live exchange rates for the **Place (PLC)**, the most stable currency in the office.

A single static page with no build step and no dependencies:

- Converts Place to and from about 30 real currencies (EUR by default). You can type in either field and swap the direction.
- Shows a live rate that ticks every couple of seconds, plus the 24h change.
- Has a trend chart for 1D / 1W / 1M / 3M / 1Y, with hover tooltips.
- Light and dark themes: follows the system setting by default, with a toggle (remembered per browser) in the top right. Works on phones.

## How the rates work

- **Real currencies:** European Central Bank reference rates from the free [Frankfurter](https://frankfurter.dev) API (no API key). If the API can't be reached, the page uses a built-in snapshot.
- **Place:** a deterministic, seeded random walk on top of a strong uptrend, with the occasional (mostly upward) "Place event" jump. The whole history is scaled so the page opens at exactly **1 PLC = 4.3343 EUR**. After that the rate keeps moving, but only within ±0.00002 EUR, so the displayed (rounded) rate never changes while the page is open.

## Tweaking the joke

Edit the `PLACE` block at the top of [`app.js`](app.js):

```js
const PLACE = {
  name: 'Place',
  code: 'PLC',
  rateEur: 4.3343,       // 1 Place in EUR, shown on page load
  liveMove: 0.00002,     // max drift from rateEur after load (keeps the rounded rate fixed)
  growthPerYear: 0.8,    // steady uptrend (+80% a year; the up-jumps add more)
  dailyVol: 0.008,       // typical daily move in the history (0.8%)
  meanReversion: 0.06,   // pull everyday noise back toward the trend
  eventChance: 0.03,     // chance per day of a big, lasting "Place event" jump
  eventSize: 0.05,       // size of such an event (5%)
  eventUpChance: 0.9,    // share of events that are jumps up
  genesis: '2024-01-01', // first trading day
  seed: 'place',         // change for a completely different history
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
