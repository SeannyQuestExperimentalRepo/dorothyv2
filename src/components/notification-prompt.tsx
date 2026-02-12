"use client";

import { useEffect, useState } from "react";

export function NotificationPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    // Only show on supported browsers with SW
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    // Don't show if already denied or subscribed
    if (Notification.permission === "denied") return;
    if (Notification.permission === "granted") {
      // Check if already subscribed
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          if (sub) setSubscribed(true);
          else setShowPrompt(true);
        });
      });
      return;
    }

    // Check if we've already dismissed (sessionStorage)
    if (sessionStorage.getItem("push-dismissed")) return;

    // Show after 10 seconds on the page
    const timer = setTimeout(() => setShowPrompt(true), 10000);
    return () => clearTimeout(timer);
  }, []);

  const handleSubscribe = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setShowPrompt(false);
        return;
      }

      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) {
        console.warn("[Push] VAPID public key not configured");
        setShowPrompt(false);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey) as BufferSource,
      });

      // Send subscription to server
      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (res.ok) {
        setSubscribed(true);
        setShowPrompt(false);
      }
    } catch (err) {
      console.error("[Push] Subscription failed:", err);
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    sessionStorage.setItem("push-dismissed", "1");
  };

  if (subscribed || !showPrompt) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-40 mx-auto max-w-sm animate-in slide-in-from-bottom-4">
      <div className="rounded-xl border border-border/60 bg-card p-4 shadow-xl">
        <p className="text-sm font-medium">Get daily pick alerts</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Get notified when today&apos;s picks are ready
        </p>
        <div className="mt-3 flex gap-2">
          <button
            onClick={handleSubscribe}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Enable notifications
          </button>
          <button
            onClick={handleDismiss}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
