import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { nextMacAppStoreBuildNumber } from "./app-store-build-number.mjs";

const { privateKey, publicKey } = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
});
const options = {
  keyId: "EXAMPLE123",
  issuerId: "00000000-0000-0000-0000-000000000000",
  bundleId: "com.example.labels",
  currentBuildNumber: 3,
};
const build = (version) => ({ attributes: { version } });

function setup(pages) {
  const key = Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }));
  const readKey = vi.fn(() => key);
  const fetchImpl = vi.fn();
  for (const page of pages) {
    fetchImpl.mockResolvedValueOnce({ ok: true, json: async () => page });
  }
  return { key, readKey, fetchImpl };
}
const apps = { data: [{ id: "12345" }] };

describe("Mac App Store build number", () => {
  it("selects 4 when Apple has already accepted build 3", async () => {
    const dependencies = setup([apps, { data: [build("3")] }]);
    expect(await nextMacAppStoreBuildNumber(options, dependencies)).toBe(4);
    const [url, request] = dependencies.fetchImpl.mock.calls[1];
    expect(url.searchParams.get("filter[app]")).toBe("12345");
    expect(url.searchParams.get("filter[preReleaseVersion.platform]")).toBe(
      "MAC_OS",
    );
    expect(url.searchParams.has("filter[preReleaseVersion.version]")).toBe(
      false,
    );
    expect(request.redirect).toBe("error");
    expect(dependencies.key.every((byte) => byte === 0)).toBe(true);
    const token = request.headers.Authorization.slice("Bearer ".length);
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url"))).toMatchObject({
      alg: "ES256",
      kid: options.keyId,
    });
    expect(JSON.parse(Buffer.from(payload, "base64url"))).toMatchObject({
      iss: options.issuerId,
      aud: "appstoreconnect-v1",
    });
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        {
          key: publicKey,
          dsaEncoding: "ieee-p1363",
        },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("reads every page and handles dotted build numbers", async () => {
    const dependencies = setup([
      apps,
      {
        data: [build("3"), build("9")],
        links: { next: "/v1/builds?cursor=next" },
      },
      { data: [build("15.2.1"), build("4")], links: { next: null } },
    ]);
    expect(await nextMacAppStoreBuildNumber(options, dependencies)).toBe(16);
    expect(dependencies.fetchImpl).toHaveBeenCalledTimes(3);
  });

  it.each([[], [build("1")]].map((data) => ({ data })))(
    "increments the local number for new or older remote builds",
    async ({ data }) => {
      expect(
        await nextMacAppStoreBuildNumber(options, setup([apps, { data }])),
      ).toBe(4);
    },
  );

  it.each(["", "text", "3beta1", "1.2.3.4", "9007199254740992", null])(
    "rejects an invalid remote number %s",
    async (version) => {
      await expect(
        nextMacAppStoreBuildNumber(
          options,
          setup([apps, { data: [build(version)] }]),
        ),
      ).rejects.toThrow("invalid build number");
    },
  );

  it.each([[], [{ id: "1" }, { id: "2" }], [{}]].map((data) => ({ data })))(
    "requires one app record",
    async ({ data }) => {
      await expect(
        nextMacAppStoreBuildNumber(options, setup([{ data }])),
      ).rejects.toThrow("Could not find one");
    },
  );

  it("stops on an API error without using the local number", async () => {
    const dependencies = setup([]);
    dependencies.fetchImpl.mockResolvedValue({ ok: false, status: 403 });
    await expect(
      nextMacAppStoreBuildNumber(options, dependencies),
    ).rejects.toThrow("HTTP 403");
  });

  it("does not send the token to another host from a page link", async () => {
    const dependencies = setup([
      apps,
      { data: [], links: { next: "https://example.com/v1/builds" } },
    ]);
    await expect(
      nextMacAppStoreBuildNumber(options, dependencies),
    ).rejects.toThrow("invalid page URL");
    expect(dependencies.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops when pagination repeats", async () => {
    const page = { data: [], links: { next: "/v1/builds?cursor=repeat" } };
    await expect(
      nextMacAppStoreBuildNumber(options, setup([apps, page, page])),
    ).rejects.toThrow("repeated a build page");
  });

  it("rejects invalid API data", async () => {
    await expect(
      nextMacAppStoreBuildNumber(options, setup([apps, {}])),
    ).rejects.toThrow("invalid build records");
  });

  it("rejects a number that cannot be increased safely", async () => {
    await expect(
      nextMacAppStoreBuildNumber(
        { ...options, currentBuildNumber: Number.MAX_SAFE_INTEGER },
        setup([apps, { data: [] }]),
      ),
    ).rejects.toThrow("too large");
  });
});
