import assert from "node:assert/strict";
import test from "node:test";
import {
  getOctoPrintStatus,
  parseOctoPrintPrinters
} from "../src/services/octoprint.js";
import { isAdminEmail } from "../src/middleware/requireAdmin.js";

test("parses an empty printer list", () => {
  assert.deepEqual(parseOctoPrintPrinters(""), []);
  assert.deepEqual(parseOctoPrintPrinters("[]"), []);
});

test("validates printer configuration and removes trailing slashes", () => {
  const [printer] = parseOctoPrintPrinters(
    '[{"id":"fdm-1","name":"FDM 1","url":"http://printer.local/","apiKey":"private-key"}]'
  );
  assert.equal(printer.url, "http://printer.local");
  assert.equal(printer.apiKey, "private-key");
});

test("rejects invalid, duplicate, and credential-bearing printer URLs", () => {
  assert.throws(() => parseOctoPrintPrinters("{"), /valid JSON/);
  assert.throws(
    () => parseOctoPrintPrinters('[{"id":"bad id","name":"Printer","url":"http://printer.local","apiKey":"key"}]'),
    /invalid printer/
  );
  assert.throws(
    () => parseOctoPrintPrinters('[{"id":"p1","name":"First","url":"http://printer.local","apiKey":"a"},{"id":"p1","name":"Second","url":"http://printer.local","apiKey":"b"}]'),
    /invalid printer/
  );
  assert.throws(
    () => parseOctoPrintPrinters('[{"id":"p1","name":"Printer","url":"http://user:pass@printer.local","apiKey":"key"}]'),
    /unsafe URL/
  );
});

test("returns printer state, temperatures, and bounded job progress without exposing its API key", async () => {
  const printer = {
    id: "fdm-1",
    name: "FDM 1",
    url: "http://printer.local",
    apiKey: "do-not-return-this"
  };
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, options });
    const body = url.endsWith("/api/printer")
      ? {
          state: {
            text: "Printing",
            flags: { operational: true, printing: true, paused: false, error: false, ready: false }
          },
          temperature: {
            tool0: { actual: 205.4, target: 210 },
            bed: { actual: 59, target: 60 }
          }
        }
      : {
          job: { file: { name: "bracket.stl" } },
          progress: { completion: 127, printTimeLeft: 600 }
        };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const status = await getOctoPrintStatus(printer, fetchMock);

  assert.equal(status.online, true);
  assert.equal(status.state, "Printing");
  assert.equal(status.flags.printing, true);
  assert.equal(status.job.name, "bracket.stl");
  assert.equal(status.job.completion, 100);
  assert.equal(status.temperatures.tool0.actual, 205.4);
  assert.equal(JSON.stringify(status).includes(printer.apiKey), false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ options }) => options.headers["X-Api-Key"] === printer.apiKey));
  assert.ok(status.checkedAt);
});

test("rejects unsuccessful OctoPrint responses", async () => {
  const printer = { id: "p1", name: "Printer", url: "http://printer.local", apiKey: "key" };
  await assert.rejects(
    getOctoPrintStatus(printer, async () => new Response("unauthorized", { status: 401 })),
    /HTTP 401/
  );
});

test("matches configured administrator emails case-insensitively", () => {
  const previous = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "ops@example.com, admin@example.com ";
  try {
    assert.equal(isAdminEmail("ADMIN@example.com"), true);
    assert.equal(isAdminEmail("customer@example.com"), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = previous;
  }
});
