// Analytics: PostHog, loaded only when a project key is set. With the key
// empty nothing is fetched and every call below is a no-op.
//
// What PostHog collects on its own once started: pageviews and page leaves,
// clicks and form submits (autocapture), heatmaps, web vitals, session
// replays, referrer and UTM parameters, device and browser, and the
// visitor's country, region, and city from their IP (GeoIP runs on the
// PostHog side). What the page adds: which sections were read, when the
// motion toggle is used, and the messages people send.

export const POSTHOG = {
  key: "",
  host: "https://us.i.posthog.com",
  assets: "https://us-assets.i.posthog.com",
};

let ph = null;
let configured = false;
// calls made before the script arrives wait here, then run in order
let pending = [];

function run(call) {
  if (ph) call(ph);
  else if (configured) pending.push(call);
  else return false;
  return true;
}

export function startAnalytics(config = POSTHOG, traits = {}) {
  if (!config.key || configured) return;
  configured = true;
  const script = document.createElement("script");
  script.async = true;
  script.src = `${config.assets}/static/array.js`;
  script.onerror = () => {
    pending = [];
    configured = false;
    console.warn("Analytics did not load.");
  };
  script.onload = () => {
    ph = window.posthog;
    ph.init(config.key, {
      api_host: config.host,
      ui_host: "https://us.posthog.com",
      person_profiles: "always",
      capture_pageview: true,
      capture_pageleave: true,
      capture_performance: true,
      autocapture: true,
      enable_heatmaps: true,
      // there is one input on the page, the message box, and its text
      // arrives as an event anyway
      session_recording: { maskAllInputs: true },
      persistence: "localStorage+cookie",
    });
    const locale = {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    };
    ph.register({ ...locale, languages: navigator.languages?.join(","), ...traits });
    ph.setPersonProperties(locale);
    for (const call of pending) call(ph);
    pending = [];
  };
  document.head.appendChild(script);
}

// true when analytics is configured: the event goes out now, or as soon as
// the script is up
export function track(event, properties = {}) {
  return run((p) => p.capture(event, properties));
}

// A visitor who leaves an address becomes a person we can answer.
export function identify(contact, properties = {}) {
  if (contact) run((p) => p.identify(contact, { contact, ...properties }));
}
