import { expect, test, describe, beforeEach, beforeAll } from "bun:test";
import {
  initRepository,
  getRepository,
  clear,
  saveEvent,
  queryEvents,
  deleteEvents,
  countEvents,
  cleanupExpiredEvents,
  queryEventsForSync,
  close,
  flush,
} from "../src/repository.ts";
import { relayService } from "../src/server.ts";
import { generateSecretKey, getPublicKey, finalizeEvent } from "nostr-tools";
import type { Event } from "nostr-tools";

describe("Repository > Database", () => {
  beforeAll(async () => {
    await initRepository(":memory:");
    relayService.setRepository(getRepository());
  });

  beforeEach(async () => {
    await clear();
  });

  const sampleEvent: Event = {
    id: "1",
    pubkey: "pub1",
    created_at: 1000,
    kind: 1,
    content: "hello",
    sig: "sig1",
    tags: [
      ["p", "target1"],
      ["t", "tag1"],
    ],
  };

  test("saveEvent and queryEvents", async () => {
    await saveEvent(sampleEvent);
    await flush();
    const results = await queryEvents({ ids: [sampleEvent.id] });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(sampleEvent.id);
  });

  test("queryEvents with filters", async () => {
    await saveEvent(sampleEvent);
    await saveEvent({
      ...sampleEvent,
      id: "2",
      created_at: 2000,
      kind: 2,
      tags: [["p", "target2"]],
    });
    await flush();

    // Authors filter
    expect(await queryEvents({ authors: ["pub1"] })).toHaveLength(2);

    // Kinds filter
    const byKind = await queryEvents({ kinds: [1] });
    expect(byKind).toHaveLength(1);
    expect(byKind[0]!.id).toBe("1");

    // Tag filter
    const target1 = await queryEvents({ "#p": ["target1"] });
    expect(target1).toHaveLength(1);
    expect(target1[0]!.id).toBe("1");
    const target2 = await queryEvents({ "#p": ["target2"] });
    expect(target2).toHaveLength(1);
    expect(target2[0]!.id).toBe("2");

    // Since filter
    const since1500 = await queryEvents({ since: 1500 });
    expect(since1500).toHaveLength(1);
    expect(since1500[0]!.id).toBe("2");

    // Until filter
    const until1500 = await queryEvents({ until: 1500 });
    expect(until1500).toHaveLength(1);
    expect(until1500[0]!.id).toBe("1");
  });

  test("deleteEvents with actual IDs and identifiers", async () => {
    const sk = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);
    const pk = getPublicKey(sk);

    // Event to be deleted by ID
    const eventToDeleteById = finalizeEvent(
      {
        kind: 1,
        created_at: now - 10,
        tags: [],
        content: "delete me by id",
      },
      sk,
    );
    await saveEvent(eventToDeleteById);

    // Event to be deleted by identifier (d-tag)
    const eventToDeleteByIdentifier = finalizeEvent(
      {
        kind: 30000,
        created_at: now - 5,
        tags: [["d", "test_identifier"]],
        content: "delete me by identifier",
      },
      sk,
    );
    await saveEvent(eventToDeleteByIdentifier);

    // Event that should not be deleted
    const eventToKeep = finalizeEvent(
      {
        kind: 1,
        created_at: now,
        tags: [],
        content: "keep me",
      },
      sk,
    );
    await saveEvent(eventToKeep);
    await flush();

    // Verify initial state
    expect(await queryEvents({})).toHaveLength(3);

    // Perform deletion
    await deleteEvents(
      pk,
      [eventToDeleteById.id],
      [`${eventToDeleteByIdentifier.kind}:${pk}:test_identifier`],
      now + 100, // Arbitrary timestamp for deletion
    );

    // Verify events are deleted
    const remainingEvents = await queryEvents({});
    expect(remainingEvents).toHaveLength(1);
    expect(remainingEvents[0]!.id).toBe(eventToKeep.id);
  });

  test("queryEvents respects limit", async () => {
    await saveEvent(sampleEvent);
    await saveEvent({
      ...sampleEvent,
      id: "2",
      created_at: 2000,
      kind: 2,
    });
    await flush();
    const limited = await queryEvents({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]!.id).toBe("2");
  });

  test("duplicate save ignored", async () => {
    await saveEvent(sampleEvent);
    await saveEvent(sampleEvent);
    await flush();
    expect(await queryEvents({})).toHaveLength(1);
  });

  test("Ignore older addressable event", async () => {
    const sk = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);

    // 1. Save a new event
    const eventNew = finalizeEvent(
      {
        kind: 30000,
        created_at: now,
        tags: [["d", "test"]],
        content: "new",
      },
      sk,
    );
    await saveEvent(eventNew);

    // 2. Try to save an older event
    const eventOld = finalizeEvent(
      {
        kind: 30000,
        created_at: now - 10,
        tags: [["d", "test"]],
        content: "old",
      },
      sk,
    );
    await saveEvent(eventOld);
    await flush();

    // 3. Verify only the newer one exists
    const stored = await queryEvents({ kinds: [30000] });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(eventNew.id);
  });

  test("cleanupExpiredEvents works", async () => {
    const sk = generateSecretKey();
    const now = Math.floor(Date.now() / 1000);

    // 1. Insert an expired event manually
    const eventExpired = finalizeEvent(
      {
        kind: 1,
        created_at: now - 100,
        tags: [["expiration", (now - 50).toString()]],
        content: "expired",
      },
      sk,
    );
    await saveEvent(eventExpired);

    // 2. Insert a valid event
    const eventValid = finalizeEvent(
      {
        kind: 1,
        created_at: now,
        tags: [["expiration", (now + 50).toString()]],
        content: "valid",
      },
      sk,
    );
    await saveEvent(eventValid);
    await flush();

    // 3. Run cleanup
    await cleanupExpiredEvents();

    // 4. Verify original event is gone but valid remains
    const stored = await queryEvents({ kinds: [1] });
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(eventValid.id);
  });

  test("countEvents works", async () => {
    await saveEvent(sampleEvent);
    await flush();
    expect(await countEvents([{ ids: [sampleEvent.id] }])).toBe(1);
  });

  test("queryEventsForSync works", async () => {
    await saveEvent(sampleEvent);
    await flush();
    const sync = await queryEventsForSync({ ids: [sampleEvent.id] });
    expect(sync).toHaveLength(1);
  });

  test("close works", async () => {
    await close();
  });
});
