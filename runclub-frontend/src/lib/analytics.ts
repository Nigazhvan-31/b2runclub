/**
 * Analytics integration for B² Club.
 * Supports Google Analytics 4 (GA4) and Microsoft Clarity.
 *
 * Configured via environment variables:
 * - VITE_GA_MEASUREMENT_ID (e.g. G-XXXXXXXXXX)
 * - VITE_CLARITY_PROJECT_ID (e.g. XXXXXXXXXX)
 */

declare global {
  interface Window {
    dataLayer?: any[];
    gtag?: (...args: any[]) => void;
    clarity?: (...args: any[]) => void;
  }
}

export const GA_MEASUREMENT_ID =
  (import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined) || "G-BJJEDM1H82";
const GA_ID = GA_MEASUREMENT_ID;
const CLARITY_ID = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;

let initialized = false;

/**
 * Initialize Google Analytics 4 and Microsoft Clarity.
 * Safely inserts the script tags into <head> only once.
 */
export function initAnalytics() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;

  // 1. Google Analytics 4 (gtag.js)
  if (GA_ID) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
      window.dataLayer?.push(arguments);
    };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID, {
      send_page_view: false, // SPA handles pageviews manually on route change
    });

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(script);
  }

  // 2. Microsoft Clarity
  if (CLARITY_ID) {
    (function (c: any, l: any, a: string, r: string, i: string) {
      c[a] =
        c[a] ||
        function () {
          (c[a].q = c[a].q || []).push(arguments);
        };
      const t = l.createElement(r);
      t.async = 1;
      t.src = "https://www.clarity.ms/tag/" + i;
      const y = l.getElementsByTagName(r)[0];
      if (y?.parentNode) {
        y.parentNode.insertBefore(t, y);
      } else {
        document.head.appendChild(t);
      }
    })(window, document, "clarity", "script", CLARITY_ID);
  }
}

/**
 * Track SPA route changes in Google Analytics 4.
 */
export function trackPageView(path: string, title?: string) {
  if (typeof window === "undefined") return;
  if (import.meta.env.DEV) {
    console.log("%c[Analytics]%c Page view: " + path, "color: #f59e0b; font-weight: bold;", "color: inherit;");
  }
  if (GA_ID && window.gtag) {
    window.gtag("event", "page_view", {
      page_path: path,
      page_title: title || document.title,
      page_location: window.location.href,
    });
  }
}

/**
 * Track custom user events in GA4 and Microsoft Clarity.
 */
export function trackEvent(eventName: string, params?: Record<string, any>) {
  if (typeof window === "undefined") return;
  if (import.meta.env.DEV) {
    console.log("%c[Analytics]%c Event: " + eventName, "color: #10b981; font-weight: bold;", "color: inherit;", params || {});
  }
  if (window.gtag) {
    window.gtag("event", eventName, params);
  }
  if (window.clarity) {
    window.clarity("event", eventName);
  }
}

/**
 * Track checkout initiation when user opens Razorpay.
 */
export function trackBeginCheckout(params: {
  eventTitle: string;
  amountRupees: number;
  orderId?: string;
}) {
  trackEvent("begin_checkout", {
    item_name: params.eventTitle,
    value: params.amountRupees,
    currency: "INR",
    transaction_id: params.orderId,
  });
}

/**
 * Track successful ticket booking / payment in GA4 and Clarity.
 */
export function trackPurchase(params: {
  eventTitle: string;
  amountRupees: number;
  orderId: string;
}) {
  trackEvent("purchase", {
    transaction_id: params.orderId,
    value: params.amountRupees,
    currency: "INR",
    items: [
      {
        item_name: params.eventTitle,
        price: params.amountRupees,
        quantity: 1,
      },
    ],
  });

  if (window.clarity) {
    window.clarity("set", "conversion", "ticket_purchased");
    window.clarity("set", "event_title", params.eventTitle);
  }
}
