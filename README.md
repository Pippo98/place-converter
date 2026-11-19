# Place Converter

Live exchange rates for the **Place (PLC)**, the most stable currency in the office.

A single static page with no build step and no dependencies:

- Converts Place to and from about 30 real currencies (EUR by default). You can type in either field and swap the direction.
- Shows a live rate that ticks every couple of seconds, plus the 24h change.
- Has a trend chart for 1D / 1W / 1M / 3M / 1Y, with hover tooltips.
- Light and dark themes: follows the system setting by default, with a toggle (remembered per browser) in the top right. Works on phones.

## How the rates work

- **Real currencies:** European Central Bank reference rates from the free [Frankfurter](https://frankfurter.dev) API (no API key). If the API can't be reached, the page uses a built-in snapshot.
- **Place:** a deterministic, seeded random walk that drifts back toward a "fair value", with the occasional dramatic "Place event". Because it's deterministic, everyone at the party sees exactly the same rate at the same moment, and the history never changes.

## Tweaking the joke

Edit the `PLACE` block at the top of [`app.js`](app.js):

```js
const PLACE = {
  name: 'Place',
  code: 'PLC',
  baseEur: 2.5,          // long-run "fair value" of 1 Place, in EUR
  dailyVol: 0.018,       // typical daily move (1.8%)
  meanReversion: 0.03,   // pull back toward baseEur each day
  eventChance: 0.03,     // chance per day of a big "Place event"
  eventSize: 0.08,       // size of such an event (8%)
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
