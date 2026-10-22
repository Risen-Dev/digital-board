// Service worker: shows Web Push notifications (lib/push.ts) and opens the app on click.
self.addEventListener("push", (event) => {
  const { title, body, url } = event.data ? event.data.json() : { title: "Digital Board", body: "", url: "/board" };
  // Same tag as the in-tab alert, so a push that lands while a tab is open replaces it instead of doubling up.
  event.waitUntil(self.registration.showNotification(title, { body, tag: "digital-board", data: { url }, icon: "/icon-192.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/board", self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const tab = tabs.find((c) => new URL(c.url).pathname.startsWith("/board"));
    if (tab) return tab.focus().then((c) => c.navigate(url));
    return self.clients.openWindow(url);
  })());
});
