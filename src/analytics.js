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

export function startAnalytics(config = POSTHOG, traits = {}) {
  if (!config.key || ph) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `${config.assets}/static/array.js`;
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
      session_recording: {
        // there is one input on the page, the message box, and its text
        // arrives as an event anyway
        maskAllInputs: true,
        maskTextSelector: null,
      },
      persistence: "localStorage+cookie",
    });
    ph.register({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      languages: navigator.languages?.join(","),
      ...traits,
    });
    ph.setPersonProperties({
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
    });
  };
  document.head.appendChild(script);
}

// true when analytics is running and the event was handed to PostHog
export function track(event, properties = {}) {
  if (!ph) return false;
  ph.capture(event, properties);
  return true;
}

// A visitor who leaves an address becomes a person we can answer.
export function identify(contact, properties = {}) {
  if (!ph || !contact) return;
  ph.identify(contact, { contact, ...properties });
}
