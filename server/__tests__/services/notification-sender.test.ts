/**
 * Unit tests for NotificationSender. We mock `web-push` so the tests
 * never make a real HTTP call — every assertion is on the wrapper's
 * own behaviour (no-op when VAPID is unset, fan-out to every device,
 * dead-subscription pruning on 410).
 */

const setVapidDetailsMock = jest.fn();
const sendNotificationMock = jest.fn<Promise<unknown>, unknown[]>();

jest.mock("web-push", () => ({
  __esModule: true,
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
  setVapidDetails: setVapidDetailsMock,
  sendNotification: sendNotificationMock,
}));

import { NotificationSender } from "../../src/services/notification-sender";
import { PushSubscriptionStore } from "../../src/services/push-subscription-store";

const sub = (endpoint: string) => ({
  endpoint,
  keys: { p256dh: `p256-${endpoint}`, auth: `auth-${endpoint}` },
});

describe("NotificationSender", () => {
  beforeEach(() => {
    setVapidDetailsMock.mockReset();
    sendNotificationMock.mockReset();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    // Reset config module so the sender re-reads env on next instantiation
    jest.resetModules();
  });

  function makeSender(opts: { configured: boolean }) {
    if (opts.configured) {
      process.env.VAPID_PUBLIC_KEY = "pub-key";
      process.env.VAPID_PRIVATE_KEY = "priv-key";
    }
    // Re-require to pick up env changes inside config.
    jest.isolateModules(() => {
      // No-op block; just ensures fresh module state per test
    });
    const store = new PushSubscriptionStore();
    // Re-import inside isolateModules so the freshly-read env is used
    const { NotificationSender: FreshSender } = jest.requireActual<{
      NotificationSender: typeof NotificationSender;
    }>("../../src/services/notification-sender");
    return { sender: new FreshSender(store), store };
  }

  it("is a no-op when VAPID isn't configured", async () => {
    const { sender, store } = makeSender({ configured: false });
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push.example/abc"),
    });

    const sent = await sender.sendToEmail("alice@example.com", {
      title: "Hi",
      body: "test",
    });

    expect(sent).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("returns 0 with no error when the recipient has no subscriptions", async () => {
    const { sender } = makeSender({ configured: true });
    const sent = await sender.sendToEmail("nobody@example.com", {
      title: "Hi",
      body: "test",
    });
    expect(sent).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("fans out to every device for the recipient's email", async () => {
    const { sender, store } = makeSender({ configured: true });
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push.example/laptop"),
    });
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push.example/phone"),
    });
    sendNotificationMock.mockResolvedValue({ statusCode: 201 });

    const sent = await sender.sendToEmail("alice@example.com", {
      title: "Trip shared",
      body: "Japan Adventure",
      url: "/shared/abc",
    });

    expect(sent).toBe(2);
    expect(sendNotificationMock).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(sendNotificationMock.mock.calls[0]![1] as string);
    expect(payload.title).toBe("Trip shared");
    expect(payload.url).toBe("/shared/abc");
  });

  it("prunes dead subscriptions on 410 Gone", async () => {
    const { sender, store } = makeSender({ configured: true });
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push.example/dead"),
    });
    const err = Object.assign(new Error("Gone"), { statusCode: 410 });
    sendNotificationMock.mockRejectedValue(err);

    const sent = await sender.sendToEmail("alice@example.com", {
      title: "Hi",
      body: "test",
    });

    expect(sent).toBe(0);
    expect(store.listForEmail("alice@example.com")).toEqual([]);
  });

  it("does not prune on transient (5xx) failures", async () => {
    const { sender, store } = makeSender({ configured: true });
    store.upsert({
      userId: "u1",
      email: "alice@example.com",
      subscription: sub("https://push.example/transient"),
    });
    const err = Object.assign(new Error("Service Unavailable"), { statusCode: 503 });
    sendNotificationMock.mockRejectedValue(err);

    const sent = await sender.sendToEmail("alice@example.com", {
      title: "Hi",
      body: "test",
    });

    expect(sent).toBe(0);
    expect(store.listForEmail("alice@example.com")).toHaveLength(1);
  });

  it("ignores the call when email is undefined (anonymous shares)", async () => {
    const { sender } = makeSender({ configured: true });
    const sent = await sender.sendToEmail(undefined, { title: "Hi", body: "test" });
    expect(sent).toBe(0);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });
});
